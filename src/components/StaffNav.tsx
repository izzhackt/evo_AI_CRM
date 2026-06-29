"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

const NAV_ICON: Record<string, IconName> = {
  "/dashboard": "grid",
  "/sales": "funnel",
  "/clients": "users",
  "/applications": "file-check",
  "/documents": "folder",
  "/whatsapp": "message-circle",
  "/calls": "phone",
  "/chat": "message-square",
  "/tasks": "check-square",
  "/reports": "bar-chart",
  "/finance": "wallet",
  "/settings": "settings",
};

export type NavGroup = { label: string; items: Array<{ href: string; label: string }> };

export function StaffNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-5 px-3 py-4 lg:flex-1 lg:overflow-y-auto">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-fg-3">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-10 items-center gap-[11px] rounded-nav px-3 py-[9px] text-[13.5px] transition-[background-color,color] duration-150 ease-out",
                    active
                      ? "bg-accent-weak font-semibold text-accent"
                      : "font-medium text-fg-2 hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <Icon name={NAV_ICON[item.href] ?? "grid"} size={18} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
