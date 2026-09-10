"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { logoutStudentPortalAction } from "@/lib/student-portal-auth-actions";

const SECTIONS = [
  { href: "/portal", label: "Поступление" },
  { href: "/portal/documents", label: "Документы" },
  { href: "/portal/applications", label: "Заявки" },
  { href: "/portal/universities", label: "Университеты" },
  { href: "/portal/payments", label: "Оплата" },
  { href: "/portal/notifications", label: "Уведомления" },
  { href: "/portal/tests", label: "Тесты" },
] as const;

export function PortalShell({
  children,
  displayName,
  preview = false,
}: {
  children: React.ReactNode;
  displayName: string;
  preview?: boolean;
}) {
  const pathname = usePathname();
  const base = preview ? "/preview/student" : "/portal";

  return (
    <div className="v3-world min-h-dvh" data-testid="student-portal-shell">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-20 max-w-[1180px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            href={base}
            className="inline-flex shrink-0 items-center rounded-nav focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
            aria-label="EVO Admissions — кабинет студента"
          >
            <EvoLogo width={116} />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <p className="hidden max-w-48 truncate text-sm font-medium text-fg-2 sm:block">
              {displayName}
            </p>
            {preview ? (
              <Link
                href="/"
                className="inline-flex min-h-11 items-center rounded-nav border border-control-edge px-3 text-sm font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Вернуться в CRM
              </Link>
            ) : <form action={logoutStudentPortalAction}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-nav border border-control-edge px-3 text-sm font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
              >
                Выйти
              </button>
            </form>}
          </div>
        </div>
      </header>

      {preview ? (
        <aside aria-label="Режим предпросмотра" className="border-b border-border bg-surface-2" data-testid="student-portal-preview-banner">
          <div className="mx-auto max-w-[1180px] px-4 py-3 sm:px-6">
            <p className="text-sm font-semibold text-fg">Предпросмотр кабинета студента</p>
            <p className="mt-1 max-w-[850px] text-sm leading-6 text-fg-2">
              Вы остаётесь в аккаунте Admin. Личные дела и ответы студентов не загружаются.
              Разделы поступления показаны без данных; каталог университетов — действующий.
              В тестах можно посмотреть вопросы без сохранения и оценки.
            </p>
          </div>
        </aside>
      ) : null}

      <nav
        aria-label="Разделы кабинета"
        className="sticky top-0 z-20 border-b border-border bg-surface"
      >
        <ul
          aria-label="Навигация по разделам кабинета"
          tabIndex={0}
          className="mx-auto flex w-full max-w-[1180px] gap-1 overflow-x-auto px-3 py-2 sm:px-5"
        >
          {SECTIONS.map((section) => {
            const href = `${base}${section.href.slice("/portal".length)}`;
            const active = pathname === href || ((section.href === "/portal/tests" || section.href === "/portal/universities") && pathname.startsWith(`${href}/`));
            return (
              <li key={section.href} className="shrink-0">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  onFocus={(event) =>
                    event.currentTarget.scrollIntoView({
                      block: "nearest",
                      inline: "nearest",
                    })
                  }
                  className={`inline-flex min-h-11 items-center rounded-nav px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                    active
                      ? "bg-accent-weak text-accent"
                      : "text-fg-2 hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {children}
    </div>
  );
}
