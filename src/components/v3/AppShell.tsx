"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  fixedRoleCanAccessRoute,
  type FixedRole,
  type FixedRoleRoute,
} from "@/lib/fixed-role-policy";
import {
  logoutStaffAction,
  selectStaffRolePreviewAction,
} from "@/lib/staff-auth-actions";

/**
 * Оболочка продукта.
 *
 * До этого части V3 лежали каталогом и открывались по одной — так они и
 * собирались. Теперь это один интерфейс, поэтому вместо ссылки «назад к
 * каталогу» у каждой страницы одна и та же навигация.
 *
 * Профиля в списке разделов нет намеренно: в продукте он открывается с
 * человека — из воронки или из переписки, — а не выбирается из меню.
 */
const SECTIONS = [
  { href: "/v3/main", label: "Главная" },
  { href: "/v3/pipeline", label: "Воронка" },
  { href: "/v3/inbox", label: "Входящие" },
  { href: "/v3/calendar", label: "Календарь" },
  { href: "/v3/knowledge", label: "База знаний" },
  { href: "/v3/settings", label: "Настройки" },
] as const satisfies readonly Readonly<{
  href: FixedRoleRoute;
  label: string;
}>[];

const ROLE_LABELS = {
  admin: "Director/Admin",
  sales: "Sales Manager",
  admissions: "Admissions Manager",
} as const satisfies Record<FixedRole, string>;

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
        className="border-b border-border bg-surface md:sticky md:top-0 md:h-dvh md:w-[224px] md:shrink-0 md:border-b-0 md:border-e"
      >
        <p className="hidden px-4 pb-3 pt-5 font-mono text-2xs uppercase tracking-wide text-fg-3 md:block">
          EVO
        </p>

        <ul className="grid grid-cols-3 gap-1 p-2 md:flex md:flex-col md:gap-0.5 md:px-3 md:pb-3 md:pt-0">
          {sections.map((section) => {
            const active = pathname === section.href;
            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center justify-center rounded-nav px-3 text-center text-sm md:justify-start md:text-start ${
                    active
                      ? "bg-accent font-medium text-on-accent"
                      : "text-fg-2 hover:bg-surface-2"
                  }`}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="border-t border-border px-4 py-3 text-xs text-fg-3 md:py-4">
          <span className="block truncate text-fg-2">{displayName}</span>
          <span
            className="font-mono uppercase"
            data-testid="active-role"
            data-role={presentationRole}
            data-authority-role={authorityRole}
          >
            {ROLE_LABELS[presentationRole]}
          </span>
        </p>

        {authorityRole === "admin" ? (
          <section
            className="border-t border-border px-3 py-3"
            data-testid="staff-role-preview"
          >
            <p className="px-1 text-2xs font-medium uppercase tracking-wide text-fg-3">
              Предпросмотр роли
            </p>
            <form
              action={selectStaffRolePreviewAction}
              className="mt-2 grid grid-cols-3 gap-1 md:grid-cols-1"
              data-testid="admin-role-preview"
            >
              {(Object.keys(ROLE_LABELS) as FixedRole[]).map((role) => (
                <button
                  key={role}
                  type="submit"
                  name="role"
                  value={role}
                  data-testid={`preview-role-${role}`}
                  aria-pressed={presentationRole === role}
                  className="min-h-10 rounded-nav border border-control-edge px-2 text-xs text-fg-2 transition-colors hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-on-accent"
                >
                  {ROLE_LABELS[role]}
                </button>
              ))}
            </form>
            {previewing ? (
              <p
                className="mt-2 px-1 text-xs leading-5 text-accent"
                data-testid="preview-active"
              >
                Admin показывает интерфейс роли {ROLE_LABELS[presentationRole]}.
              </p>
            ) : null}
          </section>
        ) : null}

        <form action={logoutStaffAction} className="border-t border-border p-3">
          <button
            type="submit"
            data-testid="staff-logout"
            className="min-h-11 w-full rounded-nav border border-control-edge px-3 text-sm font-medium text-fg-2 transition-colors hover:bg-surface-2"
          >
            Выйти
          </button>
        </form>
      </nav>

      {/* Контейнер, а не окно: рельс забирает 224px, и раскладки внутри должны
          считать доступную им ширину, иначе двухколоночный экран включается
          раньше, чем в него что-то помещается. */}
      <div className="@container min-w-0 flex-1">{children}</div>
    </div>
  );
}
