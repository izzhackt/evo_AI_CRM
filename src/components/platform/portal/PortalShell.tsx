"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { LOCALES, type Locale } from "@/lib/i18n-data";
import { setPlatformLocaleAction } from "@/lib/platform-admissions-actions";
import { EvoWordmark } from "@/components/platform/EvoWordmark";

import { PortalIcon } from "./PortalIcon";
import {
  PortalSideNavigation,
  type PortalNavigationItem,
} from "./PortalNavigation";
import { getPortalCopy } from "./portal-copy";
import styles from "./portal.module.css";

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function isActive(pathname: string, href: string) {
  return href === "/portal" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalPlatformLanguageSwitcher({
  current,
  label,
}: {
  current: Locale;
  label: string;
}) {
  return (
    <form
      action={setPlatformLocaleAction}
      aria-label={label}
      className={styles.languageForm}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="submit"
          name="locale"
          value={locale}
          aria-pressed={locale === current}
          className={`${styles.languageButton} ${
            locale === current ? styles.languageButtonActive : ""
          }`}
        >
          {locale}
        </button>
      ))}
    </form>
  );
}

function PortalMobileNavigation({
  primaryItems,
  moreItems,
  navigationLabel,
  moreLabel,
  moreTitle,
  closeLabel,
  portalName,
}: {
  primaryItems: readonly PortalNavigationItem[];
  moreItems: readonly PortalNavigationItem[];
  navigationLabel: string;
  moreLabel: string;
  moreTitle: string;
  closeLabel: string;
  portalName: string;
}) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const shouldReturnFocusRef = useRef(true);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const currentMoreItem = moreItems.find((item) => isActive(pathname, item.href));
  const isMoreRoute = Boolean(currentMoreItem);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isMoreOpen && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => {
        dialog.querySelector<HTMLElement>("[data-more-first]")?.focus();
      });
    } else if (!isMoreOpen && dialog.open) {
      dialog.close();
    }
  }, [isMoreOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) return;
    shouldReturnFocusRef.current = false;
    dialog.close();
  }, [pathname]);

  function openMore() {
    shouldReturnFocusRef.current = true;
    setIsMoreOpen(true);
  }

  function closeMore(returnFocus = true) {
    shouldReturnFocusRef.current = returnFocus;
    setIsMoreOpen(false);
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close();
    }
  }

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeMore();
  }

  return (
    <>
      <nav aria-label={navigationLabel} className={styles.bottomNav}>
        {primaryItems.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`${styles.bottomLink} ${active ? styles.bottomLinkActive : ""}`}
            >
              <PortalIcon name={item.icon} size={21} />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          ref={moreButtonRef}
          type="button"
          className={`${styles.bottomLink} ${styles.bottomButton} ${
            isMoreRoute ? styles.bottomLinkActive : ""
          }`}
          aria-haspopup="dialog"
          aria-expanded={isMoreOpen}
          aria-controls="portal-more-navigation"
          aria-label={currentMoreItem ? `${moreLabel}: ${currentMoreItem.label}` : moreLabel}
          onClick={openMore}
        >
          <span className={styles.moreButtonIcon} aria-hidden="true">
            <PortalIcon name="chevron-right" size={21} />
          </span>
          <span>{moreLabel}</span>
        </button>
      </nav>

      <dialog
        ref={dialogRef}
        id="portal-more-navigation"
        className={styles.moreDialog}
        aria-labelledby="portal-more-navigation-title"
        onCancel={(event) => {
          event.preventDefault();
          closeMore();
        }}
        onClose={() => {
          setIsMoreOpen(false);
          if (shouldReturnFocusRef.current) {
            requestAnimationFrame(() => moreButtonRef.current?.focus());
          }
        }}
        onClick={handleBackdropClick}
      >
        <div className={styles.moreSheet}>
          <div className={styles.moreHeader}>
            <div>
              <div className={styles.moreEyebrow}>{portalName}</div>
              <h2 id="portal-more-navigation-title" className={styles.moreTitle}>
                {moreTitle}
              </h2>
            </div>
            <button
              type="button"
              className={styles.moreClose}
              aria-label={closeLabel}
              onClick={() => closeMore()}
            >
              <PortalIcon className={styles.moreCloseIcon} name="chevron-right" size={21} />
            </button>
          </div>
          <nav aria-label={moreTitle} className={styles.moreNavigation}>
            {moreItems.map((item, index) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-more-first={index === 0 ? "" : undefined}
                  aria-current={active ? "page" : undefined}
                  className={`${styles.moreLink} ${active ? styles.moreLinkActive : ""}`}
                  onClick={() => closeMore(false)}
                >
                  <span className={styles.moreLinkIcon}>
                    <PortalIcon name={item.icon} size={21} />
                  </span>
                  <span>{item.label}</span>
                  <PortalIcon name="chevron-right" size={18} />
                </Link>
              );
            })}
          </nav>
        </div>
      </dialog>
    </>
  );
}

export function PortalShell({
  user,
  unreadNotificationCount,
  locale,
  children,
}: {
  user: Readonly<{ name: string }>;
  unreadNotificationCount: number;
  locale: Locale;
  children: ReactNode;
}) {
  const copy = getPortalCopy(locale);
  const unreadCount = Math.max(0, Math.min(unreadNotificationCount, 99));

  const allNavigation: readonly PortalNavigationItem[] = [
    { href: "/portal", label: copy.home, icon: "home" },
    { href: "/portal/documents", label: copy.documents, icon: "documents" },
    { href: "/portal/applications", label: copy.applications, icon: "applications" },
    { href: "/portal/visa", label: copy.visa, icon: "visa" },
    { href: "/portal/payments", label: copy.payments, icon: "payments" },
    { href: "/portal/messages", label: copy.messages, icon: "messages" },
    { href: "/portal/team", label: copy.team, icon: "team" },
    { href: "/portal/profile", label: copy.profile, icon: "profile" },
  ];
  const mobileNavigation = allNavigation.filter((item) =>
    ["/portal", "/portal/documents", "/portal/applications", "/portal/messages"].includes(item.href),
  );
  const mobileMoreNavigation = allNavigation.filter((item) =>
    ["/portal/visa", "/portal/payments", "/portal/team", "/portal/profile"].includes(item.href),
  );

  return (
    <div className={styles.root}>
      <a href="#portal-main" className={styles.skipLink}>
        {copy.skipToContent}
      </a>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <Link href="/portal" className={styles.brand} aria-label={`${copy.portalName} · EVO Admissions`}>
            <EvoWordmark />
          </Link>
          <PortalSideNavigation items={allNavigation} label={copy.navigation} />
          <div className={styles.sideFooter}>
            <div className={styles.sideFooterName}>{user.name}</div>
            <div className={styles.sideFooterRole}>{copy.portalName}</div>
          </div>
        </aside>

        <div className={styles.workspace}>
          <header className={styles.topbar}>
            <Link href="/portal" className={styles.mobileBrand} aria-label={`${copy.portalName} · EVO Admissions`}>
              <EvoWordmark />
            </Link>
            <div className={styles.portalLabel}>{copy.portalName}</div>
            <div className={styles.topbarActions}>
              <div className={styles.topbarLanguage}>
                <PortalPlatformLanguageSwitcher current={locale} label={copy.language} />
              </div>
              <Link
                href="/portal/notifications"
                className={styles.notificationLink}
                aria-label={`${copy.openNotifications}: ${unreadCount} ${copy.notificationCount}`}
              >
                <PortalIcon name="notifications" size={20} />
                {unreadCount > 0 && (
                  <span
                    className={styles.notificationBadge}
                    data-testid="portal-notifications-unread-badge"
                  >
                    {unreadCount}
                  </span>
                )}
              </Link>
              <div className={styles.identity}>
                <span className={styles.avatar} aria-hidden="true">
                  {initials(user.name)}
                </span>
                <div className={styles.identityText}>
                  <div className={styles.identityName}>{user.name}</div>
                  <div className={styles.identityRole}>{copy.portalName}</div>
                </div>
              </div>
            </div>
          </header>

          <main id="portal-main" className={styles.main} tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <PortalMobileNavigation
        primaryItems={mobileNavigation}
        moreItems={mobileMoreNavigation}
        navigationLabel={copy.navigation}
        moreLabel={copy.more}
        moreTitle={copy.moreNavigation}
        closeLabel={copy.closeMoreNavigation}
        portalName={copy.portalName}
      />
    </div>
  );
}
