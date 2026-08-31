"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/icons";
import { EvoWordmark } from "@/components/platform/EvoWordmark";
import type { Locale } from "@/lib/i18n-data";
import type { ProviderDisplayStatus } from "@/lib/provider-display-status";

type Meta = { title: string };

const STATUS_COPY: Record<
  Locale,
  {
    platform: string;
    ai: Record<ProviderDisplayStatus, string>;
    amo: Record<ProviderDisplayStatus, string>;
    whatsapp: Record<ProviderDisplayStatus, string>;
  }
> = {
  ru: {
    platform: "EVO Platform",
    ai: {
      not_configured: "Gemini: не настроено",
      configured_not_verified: "Gemini: настроено, не проверено",
      blocked: "Gemini: заблокировано",
    },
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
    ai: {
      not_configured: "Gemini: жөндөлгөн эмес",
      configured_not_verified: "Gemini: жөндөлгөн, текшерилген жок",
      blocked: "Gemini: бөгөттөлгөн",
    },
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
    ai: {
      not_configured: "Gemini: not configured",
      configured_not_verified: "Gemini: configured, not verified",
      blocked: "Gemini: blocked",
    },
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
    ai: ProviderDisplayStatus;
    amo: ProviderDisplayStatus;
    whatsapp: ProviderDisplayStatus;
  };
  homeHref?: string;
  languageSwitcher: ReactNode;
}) {
  const pathname = usePathname();
  const base = `/${pathname.split("/")[1] ?? ""}`;
  const meta = titles[base] ?? titles["/dashboard"];
  const statusCopy = STATUS_COPY[locale];
  const aiStatusCopy = statusCopy.ai[integrationStatus.ai];
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
            <p className="staff-topbar__desktop-title">{meta.title}</p>
          </div>
          <p className="staff-topbar__mobile-title">{meta.title}</p>
        </div>

        <div className="staff-topbar__status" aria-label={`${amoStatusCopy}; ${whatsappStatusCopy}; ${aiStatusCopy}`}>
          <span className={`provider-status provider-status--${integrationStatus.amo.replaceAll("_", "-")}`}>
            <span className="provider-status__dot" aria-hidden="true" />
            {amoStatusCopy}
          </span>
          <span className={`provider-status provider-status--${integrationStatus.whatsapp.replaceAll("_", "-")}`}>
            <span className="provider-status__dot" aria-hidden="true" />
            {whatsappStatusCopy}
          </span>
          <span className={`provider-status provider-status--${integrationStatus.ai.replaceAll("_", "-")}`}>
            <span className="provider-status__dot" aria-hidden="true" />
            {aiStatusCopy}
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
          <span className={`provider-status provider-status--${integrationStatus.ai.replaceAll("_", "-")}`}>
            <span className="provider-status__dot" aria-hidden="true" />
            {aiStatusCopy}
          </span>
        </div>
        <div className="staff-topbar__mobile-language">
          {languageSwitcher}
        </div>
      </div>
    </header>
  );
}
