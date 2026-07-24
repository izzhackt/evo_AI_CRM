"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

const NAV_ICON: Record<string, IconName> = {
  "/dashboard": "grid",
  "/sales": "funnel",
  "/clients": "users",
  "/applications": "file-check",
  "/documents": "folder",
  "/visa": "file-check",
  "/whatsapp": "message-circle",
  "/calls": "phone",
  "/notifications": "bell",
  "/chat": "message-square",
  "/tasks": "check-square",
  "/reports": "bar-chart",
  "/finance": "wallet",
  "/settings": "settings",
};

export type NavGroup = { label: string; items: Array<{ href: string; label: string }> };

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StaffNav({
  groups,
  label = "Staff navigation",
}: {
  groups: NavGroup[];
  label?: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="staff-side-nav">
      {groups.map((group, groupIndex) => {
        const headingId = `staff-nav-group-${groupIndex}`;
        return (
          <section key={group.label} aria-labelledby={headingId} className="staff-nav-group">
            <h2 id={headingId} className="staff-nav-group__label">
              {group.label}
            </h2>
            <ul role="list" className="staff-nav-list">
              {group.items.map((item) => {
                const active = isCurrentPath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={item.label}
                      aria-current={active ? "page" : undefined}
                      className={cn("staff-nav-link", active && "staff-nav-link--active")}
                    >
                      <Icon name={NAV_ICON[item.href] ?? "grid"} size={18} className="shrink-0" />
                      <span className="staff-nav-link__label">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

export type MobileNavCopy = {
  navigationLabel: string;
  moreLabel: string;
  menuTitle: string;
  closeLabel: string;
};

const URGENT_HREFS = ["/whatsapp", "/tasks", "/dashboard"] as const;

export function MobileStaffNav({
  groups,
  copy,
  footer,
}: {
  groups: NavGroup[];
  copy: MobileNavCopy;
  footer?: ReactNode;
}) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const allItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const urgentItems = useMemo(() => {
    const selected = URGENT_HREFS.map((href) => allItems.find((item) => item.href === href)).filter(
      (item): item is NonNullable<typeof item> => Boolean(item),
    );
    for (const item of allItems) {
      if (selected.length >= 3) break;
      if (!selected.some((selectedItem) => selectedItem.href === item.href)) selected.push(item);
    }
    return selected.slice(0, 3);
  }, [allItems]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (menuOpen && !dialog.open) dialog.showModal();
    if (!menuOpen && dialog.open) dialog.close();
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
  }

  const urgentActive = urgentItems.some((item) => isCurrentPath(pathname, item.href));

  return (
    <>
      <nav aria-label={copy.navigationLabel} className="mobile-staff-nav">
        <ul role="list" className="mobile-staff-nav__list">
          {urgentItems.map((item) => {
            const active = isCurrentPath(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("mobile-staff-nav__item", active && "mobile-staff-nav__item--active")}
                >
                  <Icon name={NAV_ICON[item.href] ?? "grid"} size={21} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className={cn(
                "mobile-staff-nav__item",
                !urgentActive && "mobile-staff-nav__item--active",
              )}
            >
              <Icon name="menu" size={21} />
              <span>{copy.moreLabel}</span>
            </button>
          </li>
        </ul>
      </nav>

      <dialog
        ref={dialogRef}
        aria-labelledby="mobile-staff-menu-title"
        className="staff-menu-dialog"
        onCancel={closeMenu}
        onClose={closeMenu}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
      >
        <div className="staff-menu-sheet">
          <header className="staff-menu-sheet__header">
            <h2 id="mobile-staff-menu-title">{copy.menuTitle}</h2>
            <button type="button" aria-label={copy.closeLabel} onClick={closeMenu} className="staff-menu-sheet__close">
              <Icon name="x" size={20} />
            </button>
          </header>
          <nav aria-label={copy.navigationLabel} className="staff-menu-sheet__nav">
            {groups.map((group, groupIndex) => {
              const headingId = `mobile-staff-nav-group-${groupIndex}`;
              return (
                <section key={group.label} aria-labelledby={headingId} className="staff-menu-sheet__group">
                  <h3 id={headingId}>{group.label}</h3>
                  <ul role="list">
                    {group.items.map((item) => {
                      const active = isCurrentPath(pathname, item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            onClick={closeMenu}
                            className={cn("staff-menu-sheet__link", active && "staff-menu-sheet__link--active")}
                          >
                            <Icon name={NAV_ICON[item.href] ?? "grid"} size={19} />
                            <span>{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </nav>
          {footer && <footer className="staff-menu-sheet__footer">{footer}</footer>}
        </div>
      </dialog>
    </>
  );
}
