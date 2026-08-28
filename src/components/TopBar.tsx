"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/icons";
import { EvoWordmark } from "@/components/platform/EvoWordmark";
import type { Locale } from "@/lib/i18n-data";

type Meta = { title: string; hint?: string };

type ProviderState = "not_configured" | "configured_not_verified" | "blocked";

const STATUS_COPY: Record<
  Locale,
  {
    platform: string;
    ai: string;
    amo: Record<ProviderState, string>;
    whatsapp: Record<ProviderState, string>;
  }
> = {
  ru: {
    platform: "EVO Platform",
    ai: "AI: только черновики",
    amo: {
      not_configured: "amoCRM: не настроено",
      configured_not_verified: "amoCRM: настроено, не проверено",
      blocked: "amoCRM: заблокировано",
    },
    whatsapp: {
      not_configured: "WhatsApp: не настроено",
      configured_not_verified: "WhatsApp: настроено, не проверено",
      blocked: "WhatsApp: заблокировано",
    },
  },
  ky: {
    platform: "EVO Platform",
    ai: "AI: черновик гана",
    amo: {
      not_configured: "amoCRM: жөндөлгөн эмес",
      configured_not_verified: "amoCRM: жөндөлгөн, текшерилген жок",
      blocked: "amoCRM: бөгөттөлгөн",
    },
    whatsapp: {
      not_configured: "WhatsApp: жөндөлгөн эмес",
      configured_not_verified: "WhatsApp: жөндөлгөн, текшерилген жок",
      blocked: "WhatsApp: бөгөттөлгөн",
    },
  },
  en: {
    platform: "EVO Platform",
    ai: "AI: drafts only",
    amo: {
      not_configured: "amoCRM: not configured",
      configured_not_verified: "amoCRM: configured, not verified",
      blocked: "amoCRM: blocked",
    },
    whatsapp: {
      not_configured: "WhatsApp: not configured",
      configured_not_verified: "WhatsApp: configured, not verified",
      blocked: "WhatsApp: blocked",
    },
  },
};

export function TopBar({
  titles,
  locale,
  themeLabel,
  integrationStatus,
  homeHref = "/dashboard",
  languageSwitcher,
}: {
  titles: Record<string, Meta>;
  locale: Locale;
  themeLabel: string;
  integrationStatus: {
    amo: ProviderState;
    whatsapp: ProviderState;
  };
  homeHref?: string;
  languageSwitcher: ReactNode;
}) {
  const pathname = usePathname();
  const base = `/${pathname.split("/")[1] ?? ""}`;
  const meta = titles[base] ?? titles["/dashboard"];
  const statusCopy = STATUS_COPY[locale];
  const amoStatusCopy = statusCopy.amo[integrationStatus.amo];
  const whatsappStatusCopy = statusCopy.whatsapp[integrationStatus.whatsapp];

  return (
    <header className="staff-topbar">
      <div className="staff-topbar__row">
        <Link href={homeHref} aria-label="EVO Admissions" className="staff-topbar__mobile-brand">
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

        <div className="staff-topbar__status" aria-label={`${amoStatusCopy}; ${whatsappStatusCopy}; ${statusCopy.ai}`}>
          <span className={`provider-status provider-status--${integrationStatus.amo.replaceAll("_", "-")}`}>
            <span className="provider-status__dot" aria-hidden="true" />
            {amoStatusCopy}
          </span>
          <span className={`provider-status provider-status--${integrationStatus.whatsapp.replaceAll("_", "-")}`}>
            <span className="provider-status__dot" aria-hidden="true" />
            {whatsappStatusCopy}
          </span>
          <span className="provider-status provider-status--draft">
            <span className="provider-status__dot" aria-hidden="true" />
            {statusCopy.ai}
          </span>
        </div>

        <div className="staff-topbar__actions">
          <div className="staff-topbar__language">
            {languageSwitcher}
          </div>
          <ThemeToggle label={themeLabel} />
        </div>
      </div>
      <div className="staff-topbar__mobile-meta">
        <div className="staff-topbar__mobile-status">
          <span className={`provider-status provider-status--${integrationStatus.amo.replaceAll("_", "-")}`}>
            <span className="provider-status__dot" aria-hidden="true" />
            {amoStatusCopy}
          </span>
          <span className={`provider-status provider-status--${integrationStatus.whatsapp.replaceAll("_", "-")}`}>
            <span className="provider-status__dot" aria-hidden="true" />
            {whatsappStatusCopy}
          </span>
          <span className="provider-status provider-status--draft">
            <span className="provider-status__dot" aria-hidden="true" />
            {statusCopy.ai}
          </span>
        </div>
        <div className="staff-topbar__mobile-language">
          {languageSwitcher}
        </div>
      </div>
    </header>
  );
}
