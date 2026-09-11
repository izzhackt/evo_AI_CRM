"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { logoutStudentPortalAction } from "@/lib/student-portal-auth-actions";

import styles from "./PortalShell.module.css";

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
  const [expandedForPath, setExpandedForPath] = useState<string | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const navigationOpen = expandedForPath === pathname;

  if (expandedForPath !== null && expandedForPath !== pathname) {
    setExpandedForPath(null);
  }

  return (
    <div
      className={`v3-world ${styles.shell}`}
      data-testid="student-portal-shell"
      onPointerDown={(event) => {
        if (navigationOpen && !sidebar.current?.contains(event.target as Node)) {
          setExpandedForPath(null);
        }
      }}
    >
      <a
        href="#portal-content"
        className={styles.skipLink}
        onClick={() => setExpandedForPath(null)}
      >
        Перейти к содержимому
      </a>

      <aside
        ref={sidebar}
        className={styles.sidebar}
        aria-label="Кабинет студента"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setExpandedForPath(null);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && navigationOpen) {
            setExpandedForPath(null);
            menuButton.current?.focus();
          }
        }}
      >
        <header className={styles.brandRow}>
          <Link
            href={base}
            className={styles.brand}
            aria-label="EVO Admissions — кабинет студента"
            onClick={() => setExpandedForPath(null)}
          >
            <EvoLogo width={116} />
          </Link>
          <button
            ref={menuButton}
            type="button"
            className={styles.menuButton}
            aria-expanded={navigationOpen}
            aria-controls="portal-navigation-panel"
            onClick={() => setExpandedForPath(navigationOpen ? null : pathname)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path
                d={navigationOpen ? "m5 5 8 8M13 5l-8 8" : "M3 5h12M3 9h12M3 13h12"}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            {navigationOpen ? "Закрыть" : "Меню"}
          </button>
        </header>

        <div
          id="portal-navigation-panel"
          className={styles.navigationPanel}
          data-open={navigationOpen}
        >
          <nav aria-label="Разделы кабинета" className={styles.navigation}>
            <ul aria-label="Навигация по разделам кабинета" className={styles.navigationList}>
              {SECTIONS.map((section) => {
                const href = `${base}${section.href.slice("/portal".length)}`;
                const active = pathname === href || (section.href !== "/portal" && pathname.startsWith(`${href}/`));
                return (
                  <li key={section.href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setExpandedForPath(null)}
                      className={styles.navigationLink}
                    >
                      {section.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className={styles.account}>
            <p className={styles.accountLabel}>{preview ? "Предпросмотр" : "Ваш аккаунт"}</p>
            <p className={styles.displayName}>{displayName}</p>
            {preview ? (
              <Link href="/" className={styles.accountAction}>
                Вернуться в CRM
              </Link>
            ) : (
              <form action={logoutStudentPortalAction}>
                <button type="submit" className={styles.accountAction}>
                  Выйти
                </button>
              </form>
            )}
          </div>
        </div>
      </aside>

      <div className={styles.workspace}>
        {preview ? (
          <aside
            aria-label="Режим предпросмотра"
            className={styles.previewBanner}
            data-testid="student-portal-preview-banner"
          >
            <div className={styles.previewContent}>
              <p className={styles.previewTitle}>Предпросмотр кабинета студента</p>
              <p className={styles.previewDescription}>
                Вы остаётесь в аккаунте Admin. Личные дела и ответы студентов не загружаются.
                Разделы поступления показаны без данных; каталог университетов — действующий.
                В тестах можно посмотреть вопросы без сохранения и оценки.
              </p>
            </div>
          </aside>
        ) : null}

        <div id="portal-content" tabIndex={-1} className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}
