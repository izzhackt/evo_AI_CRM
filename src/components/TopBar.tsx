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
type NotificationPreview = {
  id: string;
  title: string;
  subject: string | null;
  href: string;
};

type ProviderState = "not_configured" | "configured_not_verified" | "blocked";

const ADD_ROUTES = new Set(["/sales", "/clients", "/tasks", "/finance", "/calls", "/whatsapp"]);

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

const NOTIFICATION_COPY: Record<
  Locale,
  { label: string; heading: string; count: string; all: string; empty: string }
> = {
  ru: {
    label: "Центр внимания",
    heading: "Требует внимания",
    count: "элементов",
    all: "Открыть все уведомления",
    empty: "Срочных элементов нет",
  },
  ky: {
    label: "Көңүл буруу борбору",
    heading: "Көңүл бурууну талап кылат",
    count: "элемент",
    all: "Бардык билдирмелерди ачуу",
    empty: "Шашылыш элементтер жок",
  },
  en: {
    label: "Attention center",
    heading: "Needs attention",
    count: "items",
    all: "Open all notifications",
    empty: "No urgent items",
  },
};

export function TopBar({
  titles,
  locale,
  addLabel,
  themeLabel,
  notificationCount,
  notificationCountCapped,
  notificationPreview,
  integrationStatus,
}: {
  titles: Record<string, Meta>;
  locale: Locale;
  addLabel: string;
  themeLabel: string;
  notificationCount: number;
  notificationCountCapped: boolean;
  notificationPreview: NotificationPreview[];
  integrationStatus: {
    amo: ProviderState;
    whatsapp: ProviderState;
  };
}) {
  const pathname = usePathname();
  const base = `/${pathname.split("/")[1] ?? ""}`;
  const meta = titles[base] ?? titles["/dashboard"];
  const showAdd =
    ADD_ROUTES.has(base) &&
    !(base === "/whatsapp" && pathname !== "/whatsapp");
  const statusCopy = STATUS_COPY[locale];
  const amoStatusCopy = statusCopy.amo[integrationStatus.amo];
  const whatsappStatusCopy = statusCopy.whatsapp[integrationStatus.whatsapp];
  const notificationCopy = NOTIFICATION_COPY[locale];
  const notificationCountLabel = notificationCountCapped
    ? `${notificationCount}+`
    : String(notificationCount);

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
          <details className="notification-menu">
            <summary
              className="notification-menu__trigger"
              aria-label={`${notificationCopy.label}: ${notificationCountLabel} ${notificationCopy.count}`}
            >
              <Icon name="bell" size={18} />
              {notificationCount > 0 && (
                <span className="notification-menu__count">
                  {notificationCountLabel}
                </span>
              )}
            </summary>
            <div className="notification-menu__popover">
              <div className="notification-menu__heading">
                <span>{notificationCopy.heading}</span>
                <span>{notificationCountLabel}</span>
              </div>
              {notificationPreview.length > 0 ? (
                <ul role="list" className="notification-menu__list">
                  {notificationPreview.map((item) => (
                    <li key={item.id}>
                      <Link href={item.href} className="notification-menu__item">
                        <span>{item.title}</span>
                        {item.subject && <small>{item.subject}</small>}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="notification-menu__empty">{notificationCopy.empty}</p>
              )}
              <Link href="/notifications" className="notification-menu__all">
                {notificationCopy.all}
                <Icon name="chevron-right" size={15} />
              </Link>
            </div>
          </details>
          <div className="staff-topbar__language">
            <LangSwitcher current={locale} />
          </div>
          <ThemeToggle label={themeLabel} />
          {showAdd && (
            <Link
              href={`${base}#add`}
              aria-label={addLabel}
              className={btnCls}
              onClick={(event) => {
                const target = document.getElementById("add");
                if (!target) return;
                event.preventDefault();
                if (target instanceof HTMLDetailsElement) target.open = true;
                target.scrollIntoView({ behavior: "smooth", block: "center" });
                window.setTimeout(() => {
                  target
                    .querySelector<HTMLElement>("input:not([type='hidden']), select, textarea")
                    ?.focus({ preventScroll: true });
                }, 50);
              }}
            >
              <Icon name="plus" size={16} />
              <span className="hidden xl:inline">{addLabel}</span>
            </Link>
          )}
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
          <LangSwitcher current={locale} />
        </div>
      </div>
    </header>
  );
}
