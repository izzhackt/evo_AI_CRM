"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { EvoMark } from "@/components/platform/brand/EvoMark";
import { logoutStudentPortalAction } from "@/lib/student-portal-auth-actions";

const SECTIONS = [
  { href: "/portal", label: "Поступление" },
  { href: "/portal/documents", label: "Документы" },
  { href: "/portal/applications", label: "Заявки" },
  { href: "/portal/payments", label: "Оплата" },
  { href: "/portal/notifications", label: "Уведомления" },
] as const;

export function PortalShell({
  children,
  displayName,
}: {
  children: React.ReactNode;
  displayName: string;
}) {
  const pathname = usePathname();

  return (
    <div className="v3-world min-h-dvh" data-testid="student-portal-shell">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-16 max-w-[1180px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/portal"
            className="inline-flex min-h-11 items-center gap-2 text-fg"
            aria-label="EVO Admissions — кабинет студента"
          >
            <EvoMark size={22} tone="mono" />
            <span className="text-sm font-semibold tracking-[-0.01em]">
              EVO Admissions
            </span>
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <p className="hidden max-w-48 truncate text-xs font-medium text-fg-3 sm:block">
              {displayName}
            </p>
            <form action={logoutStudentPortalAction}>
              <button
                type="submit"
                className="inline-flex min-h-10 items-center rounded-nav border border-control-edge px-3 text-xs font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
              >
                Выйти
              </button>
            </form>
          </div>
        </div>
      </header>

      <nav
        aria-label="Разделы кабинета"
        className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur"
      >
        <ul
          aria-label="Навигация по разделам кабинета"
          tabIndex={0}
          className="mx-auto flex w-full max-w-[1180px] gap-1 overflow-x-auto px-3 py-2 sm:px-5"
        >
          {SECTIONS.map((section) => {
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
                  className={`inline-flex min-h-10 items-center rounded-nav px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                    active
                      ? "bg-accent text-on-accent"
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
