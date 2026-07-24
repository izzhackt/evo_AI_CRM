"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LangSwitcher } from "@/components/LangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/icons";
import { EvoWordmark } from "@/components/platform/EvoWordmark";
import { btnCls } from "@/components/ui";
import type { Locale } from "@/lib/i18n-data";

type Meta = { title: string; hint?: string };

const ADD_ROUTES = new Set(["/sales", "/clients", "/tasks", "/finance", "/calls", "/whatsapp"]);

const STATUS_COPY: Record<Locale, { platform: string; amo: string; waha: string; ai: string }> = {
  ru: {
    platform: "EVO Platform",
    amo: "amoCRM: не проверен",
    waha: "WAHA: не проверен",
    ai: "AI: только черновики",
  },
  ky: {
    platform: "EVO Platform",
    amo: "amoCRM: текшериле элек",
    waha: "WAHA: текшериле элек",
    ai: "AI: черновик гана",
  },
  en: {
    platform: "EVO Platform",
    amo: "amoCRM: not verified",
    waha: "WAHA: not verified",
    ai: "AI: drafts only",
  },
};

export function TopBar({
  titles,
  locale,
  addLabel,
  themeLabel,
}: {
  titles: Record<string, Meta>;
  locale: Locale;
  addLabel: string;
  themeLabel: string;
}) {
  const pathname = usePathname();
  const base = `/${pathname.split("/")[1] ?? ""}`;
  const meta = titles[base] ?? titles["/dashboard"];
  const showAdd = ADD_ROUTES.has(base);
  const statusCopy = STATUS_COPY[locale];

  return (
    <header className="staff-topbar">
      <div className="staff-topbar__row">
        <Link href="/dashboard" aria-label="EVO Admissions" className="staff-topbar__mobile-brand">
          <EvoWordmark />
        </Link>

        <div className="staff-topbar__context">
          <div className="staff-topbar__breadcrumb" aria-label={`${statusCopy.platform}: ${meta.title}`}>
            <span>{statusCopy.platform}</span>
            <Icon name="chevron-right" size={14} />
            <h1 className="staff-topbar__desktop-title">{meta.title}</h1>
          </div>
          <h1 className="staff-topbar__mobile-title">{meta.title}</h1>
          {meta.hint && <p className="staff-topbar__hint">{meta.hint}</p>}
        </div>

        <div className="staff-topbar__status" aria-label={`${statusCopy.amo}; ${statusCopy.waha}; ${statusCopy.ai}`}>
          <span className="provider-status provider-status--unknown">
            <span className="provider-status__dot" aria-hidden="true" />
            {statusCopy.amo}
          </span>
          <span className="provider-status provider-status--unknown">
            <span className="provider-status__dot" aria-hidden="true" />
            {statusCopy.waha}
          </span>
          <span className="provider-status provider-status--draft">
            <span className="provider-status__dot" aria-hidden="true" />
            {statusCopy.ai}
          </span>
        </div>

        <div className="staff-topbar__actions">
          <div className="staff-topbar__language">
            <LangSwitcher current={locale} />
          </div>
          <ThemeToggle label={themeLabel} />
          {showAdd && (
            <Link href={`${base}#add`} className={btnCls}>
              <Icon name="plus" size={16} />
              <span className="hidden xl:inline">{addLabel}</span>
            </Link>
          )}
        </div>
      </div>
      <div className="staff-topbar__mobile-meta">
        <div className="staff-topbar__mobile-status">
          <span className="provider-status provider-status--unknown">
            <span className="provider-status__dot" aria-hidden="true" />
            {statusCopy.amo}
          </span>
          <span className="provider-status provider-status--unknown">
            <span className="provider-status__dot" aria-hidden="true" />
            {statusCopy.waha}
          </span>
          <span className="provider-status provider-status--draft">
            <span className="provider-status__dot" aria-hidden="true" />
            {statusCopy.ai}
          </span>
        </div>
        <div className="staff-topbar__mobile-language">
          <LangSwitcher current={locale} />
        </div>
      </div>
    </header>
  );
}
