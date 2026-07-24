"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PortalIcon, type PortalIconName } from "./PortalIcon";
import styles from "./portal.module.css";

export type PortalNavigationItem = {
  href: string;
  label: string;
  icon: PortalIconName;
};

function isActive(pathname: string, href: string) {
  return href === "/portal" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalSideNavigation({
  items,
  label,
}: {
  items: readonly PortalNavigationItem[];
  label: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className={styles.sideNav}>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`${styles.sideLink} ${active ? styles.sideLinkActive : ""}`}
          >
            <PortalIcon name={item.icon} size={21} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function PortalBottomNavigation({
  items,
  label,
}: {
  items: readonly PortalNavigationItem[];
  label: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className={styles.bottomNav}>
      {items.map((item) => {
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
    </nav>
  );
}
