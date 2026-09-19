"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import type { Locale } from "@/lib/i18n-data";
import {
  formatPortalString,
  getPortalStrings,
  type PortalStrings,
} from "@/lib/portal/i18n";
import { logoutStudentPortalAction } from "@/lib/student-portal-auth-actions";

/**
 * Портальный shell (PORT-2, дизайн-контракт
 * docs/design/portal/design-contract.md): верхняя полоса с логотипом,
 * колокольчиком и меню аккаунта; слева рейл разделов, на узком экране —
 * нижние вкладки. Стили — только pt-классы из src/app/(portal)/portal.css.
 *
 * Смоук-якоря production-прогона (scripts/evo-production-browser-smoke.mjs +
 * tests/production-browser-smoke.test.mjs): data-testid="student-portal-shell"
 * на корне и ровно один <nav aria-label="Разделы кабинета"> со ссылкой
 * href="/portal". Байт-в-байт; менять — только вместе со смоук-скриптом и его
 * контракт-тестом в одном PR (правило изоляции дизайн-контракта).
 */

/**
 * Уровень доступа по дизайн-контракту. До merge PORT-1a выводится в layout
 * из caseState той же семантикой, что закрепит сервер: pending-дело —
 * самостоятельный approved-доступ, active/closed — сопровождение (assisted).
 */
export type PortalAccessTier = "approved" | "assisted";

/**
 * Честная навигация: только реально существующие сегодня разделы
 * (Избранное — PORT-3b, Профиль — PORT-5a, Профессии/Английский — PORT-4c,
 * оба tier'а по дизайн-контракту).
 */
const SECTIONS = [
  // PORT-9c: «Главная» — отдельный маршрут; /portal остаётся «Моим
  // поступлением» (замороженные смоук-якоря: вход после логина, заголовок и
  // ссылка a[href="/portal"] в этом nav).
  { href: "/portal/home", key: "nav.home", tiers: ["approved", "assisted"] },
  { href: "/portal", key: "nav.overview", tiers: ["approved", "assisted"] },
  { href: "/portal/documents", key: "nav.documents", tiers: ["assisted"] },
  { href: "/portal/messages", key: "nav.messages", tiers: ["assisted"] },
  { href: "/portal/universities", key: "nav.universities", tiers: ["approved", "assisted"] },
  { href: "/portal/professions", key: "nav.professions", tiers: ["approved", "assisted"] },
  { href: "/portal/english", key: "nav.english", tiers: ["approved", "assisted"] },
  { href: "/portal/favorites", key: "nav.favorites", tiers: ["approved", "assisted"] },
  { href: "/portal/payments", key: "nav.payments", tiers: ["assisted"] },
  { href: "/portal/notifications", key: "nav.notifications", tiers: ["assisted"] },
  { href: "/portal/tests", key: "nav.tests", tiers: ["approved", "assisted"] },
  { href: "/portal/profile", key: "nav.profile", tiers: ["approved", "assisted"] },
] as const satisfies readonly {
  href: string;
  key: keyof PortalStrings<"shell">;
  tiers: readonly PortalAccessTier[];
}[];

function NavigationLabel({ label, opening }: { label: string; opening: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className="pt-nav-label">{label}</span>
      <span aria-hidden="true" className="pt-nav-pending">{pending ? "…" : ""}</span>
      <span className="pt-sr-only" role="status">{pending ? opening : ""}</span>
    </>
  );
}

function SectionIcon({ section }: { section: (typeof SECTIONS)[number]["key"] }) {
  const paths: Record<(typeof SECTIONS)[number]["key"], string> = {
    // Главная: дом.
    "nav.home": "M3.5 9.5 10 3.5l6.5 6M5.5 8.2V16h9V8.2M8.5 16v-4h3v4",
    // Поступление: флажок у цели маршрута.
    "nav.overview": "M5 17V3.5M5 3.5h9.5l-2 3.5 2 3.5H5",
    // Документы: лист с загнутым углом.
    "nav.documents": "M6 2.5h5.5L15 6v11.5H6zM11.5 2.5V6H15M8.2 9.5h3.6M8.2 12.5h3.6",
    // Сообщения: пузырь диалога.
    "nav.messages": "M3.5 4.5h13v8.5h-7.2L6 16v-3H3.5zM6.8 7.5h6.4M6.8 10h4.4",
    // Университеты: здание с колоннами.
    "nav.universities": "M3 8l7-4.5L17 8M4.5 8v7M8 8v7M12 8v7M15.5 8v7M3 15h14",
    // Профессии: компас — исследование направлений.
    "nav.professions": "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12.8 7.2l-1.6 4-4 1.6 1.6-4z",
    // Английский: открытая книга.
    "nav.english": "M10 5.2C8.8 4.2 7 3.7 4.6 3.7c-.6 0-1.1 0-1.6.1v11.4c.5-.1 1-.1 1.6-.1 2.4 0 4.2.5 5.4 1.5 1.2-1 3-1.5 5.4-1.5.6 0 1.1 0 1.6.1V3.8c-.5-.1-1-.1-1.6-.1-2.4 0-4.2.5-5.4 1.5zM10 5.2v11.4",
    // Избранное: сердечко.
    "nav.favorites": "M10 16.1 4.4 10.7a3.6 3.6 0 0 1 0-5.2 3.7 3.7 0 0 1 5.2 0l.4.4.4-.4a3.7 3.7 0 0 1 5.2 0 3.6 3.6 0 0 1 0 5.2z",
    // Оплата: карта.
    "nav.payments": "M3 5.5h14v9H3zM3 8.5h14M5.5 11.5h3",
    // Уведомления: колокольчик.
    "nav.notifications": "M10 3a4.5 4.5 0 0 1 4.5 4.5c0 3.2 1 4.5 1.5 5H4c.5-.5 1.5-1.8 1.5-5A4.5 4.5 0 0 1 10 3zM8.5 15.5a1.5 1.5 0 0 0 3 0",
    // Тесты: планшет с отметкой.
    "nav.tests": "M6.5 3.5h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM8 3.5V2.8h4v.7M7.7 10.2l1.6 1.6 3-3.3",
    // Профиль: человек.
    "nav.profile": "M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 16.5c.7-2.9 3-4.5 6-4.5s5.3 1.6 6 4.5",
  };
  return (
    <svg
      className="pt-nav-icon"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path d={paths[section]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 3a4.5 4.5 0 0 1 4.5 4.5c0 3.2 1 4.5 1.5 5H4c.5-.5 1.5-1.8 1.5-5A4.5 4.5 0 0 1 10 3zM8.5 15.5a1.5 1.5 0 0 0 3 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Shell({
  children,
  displayName,
  accessTier,
  locale,
}: {
  children: React.ReactNode;
  displayName: string;
  accessTier: PortalAccessTier;
  locale: Locale;
}) {
  const pathname = usePathname();
  const strings = getPortalStrings("shell", locale);
  const sections = SECTIONS.filter((section) =>
    (section.tiers as readonly PortalAccessTier[]).includes(accessTier));

  return (
    <div className="pt-shell" data-testid="student-portal-shell">
      <a href="#portal-content" className="pt-skip-link">
        {strings.skipToContent}
      </a>

      <header className="pt-topbar">
        <Link href="/portal" aria-label={strings.home} className="pt-topbar-logo">
          <EvoLogo width={104} />
        </Link>
        <div className="pt-topbar-actions">
          <Link
            href="/portal/notifications"
            aria-label={strings.notifications}
            className="pt-bell"
          >
            <BellIcon />
          </Link>
          <details className="pt-user-menu">
            <summary className="pt-user-summary">
              <span className="pt-user-summary-name">{displayName}</span>
              <svg
                className="pt-user-chevron"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
              >
                <path d="m2.5 4.5 3.5 3.5L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <div className="pt-user-panel">
              <p className="pt-user-caption">{strings.account}</p>
              <p className="pt-user-name">{displayName}</p>
              <form action={logoutStudentPortalAction}>
                <button type="submit" className="pt-logout">
                  {strings.logout}
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>

      <div className="pt-body">
        {/* Смоук-якорь: aria-label не локализуется до совместного PR со смоук-скриптом. */}
        <nav aria-label="Разделы кабинета" className="pt-nav">
          <ul className="pt-nav-list">
            {sections.map((section) => {
              const active = pathname === section.href
                || (section.href !== "/portal" && pathname.startsWith(`${section.href}/`));
              const label = strings[section.key];
              return (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    aria-current={active ? "page" : undefined}
                    className="pt-nav-link"
                  >
                    <SectionIcon section={section.key} />
                    <NavigationLabel
                      label={label}
                      opening={formatPortalString(strings.openingSection, { label })}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/*
          Существующие экраны продолжают жить в v3-мире без изменений до своих
          slice'ов — v3-world здесь сознательно, это не staff-shell.
        */}
        <div id="portal-content" tabIndex={-1} className="pt-content v3-world">
          {children}
        </div>
      </div>
    </div>
  );
}
