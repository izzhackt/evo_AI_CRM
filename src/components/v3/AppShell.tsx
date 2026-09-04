"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  fixedRoleCan,
  type FixedRole,
  type FixedRoleCapability,
} from "@/lib/fixed-role-policy";

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
  { href: "/v3/main", label: "Главная", capability: "sales.read" },
  { href: "/v3/pipeline", label: "Воронка", capability: "sales.read" },
  { href: "/v3/inbox", label: "Входящие", capability: "messaging.read" },
  { href: "/v3/calendar", label: "Календарь", capability: "admissions.read" },
  { href: "/v3/knowledge", label: "База знаний", capability: "documents.read" },
  { href: "/v3/settings", label: "Настройки", capability: "admin.preview" },
] as const satisfies readonly Readonly<{
  href: string;
  label: string;
  capability: FixedRoleCapability;
}>[];

export function AppShell({
  children,
  displayName,
  presentationRole,
}: {
  children: React.ReactNode;
  displayName: string;
  presentationRole: FixedRole;
}) {
  const pathname = usePathname();
  const sections = SECTIONS.filter((section) =>
    fixedRoleCan(presentationRole, section.capability));

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
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

        <p className="hidden border-t border-border px-4 py-4 text-xs text-fg-3 md:block">
          <span className="block truncate text-fg-2">{displayName}</span>
          <span className="font-mono uppercase">{presentationRole}</span>
        </p>
      </nav>

      {/* Контейнер, а не окно: рельс забирает 224px, и раскладки внутри должны
          считать доступную им ширину, иначе двухколоночный экран включается
          раньше, чем в него что-то помещается. */}
      <div className="@container min-w-0 flex-1">{children}</div>
    </div>
  );
}
