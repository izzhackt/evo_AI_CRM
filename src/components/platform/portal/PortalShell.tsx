import Link from "next/link";
import type { ReactNode } from "react";

import type { StudentPortalSnapshot } from "@/lib/contracts/student-portal";
import type { Locale } from "@/lib/i18n-data";
import type { SessionUser } from "@/lib/auth";
import { EvoWordmark } from "@/components/platform/EvoWordmark";

import { PortalIcon } from "./PortalIcon";
import {
  PortalBottomNavigation,
  PortalSideNavigation,
  type PortalNavigationItem,
} from "./PortalNavigation";
import { PortalLanguageSwitcher } from "./PortalLanguageSwitcher";
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

export function PortalShell({
  user,
  snapshot,
  locale,
  children,
}: {
  user: SessionUser;
  snapshot: StudentPortalSnapshot | undefined;
  locale: Locale;
  children: ReactNode;
}) {
  const copy = getPortalCopy(locale);
  const unreadCount = snapshot?.updates.filter((update) => !update.isRead).length ?? 0;

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
    ["/portal", "/portal/documents", "/portal/applications", "/portal/messages", "/portal/profile"].includes(
      item.href,
    ),
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
                <PortalLanguageSwitcher current={locale} label={copy.language} />
              </div>
              <Link
                href="/portal/notifications"
                className={styles.notificationLink}
                aria-label={`${copy.openNotifications}: ${unreadCount} ${copy.notificationCount}`}
              >
                <PortalIcon name="notifications" size={20} />
                {unreadCount > 0 && (
                  <span className={styles.notificationBadge}>{Math.min(unreadCount, 99)}</span>
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
      <PortalBottomNavigation items={mobileNavigation} label={copy.navigation} />
    </div>
  );
}
