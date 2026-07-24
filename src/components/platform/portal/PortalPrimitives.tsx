import Link from "next/link";
import type { ReactNode } from "react";

import type {
  StudentPortalContact,
  StudentPortalNextAction,
  StudentPortalSnapshot,
} from "@/lib/contracts/student-portal";
import type { Locale } from "@/lib/i18n-data";

import { PortalIcon, type PortalIconName } from "./PortalIcon";
import type { PortalCopy } from "./portal-copy";
import styles from "./portal.module.css";

export function portalLocale(locale: Locale) {
  return locale === "ky" ? "ky-KG" : locale === "en" ? "en-US" : "ru-RU";
}

export function formatPortalDate(value: string | null, locale: Locale, includeTime = false) {
  if (!value) return null;
  const normalized = value.includes("T")
    ? value
    : value.includes(" ")
      ? value.replace(" ", "T")
      : `${value}T00:00:00`;
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized);
  const date = new Date(hasTimeZone ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(portalLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "UTC",
  }).format(date);
}

export function formatPortalMoney(amount: number, currency: string, locale: Locale) {
  try {
    return new Intl.NumberFormat(portalLocale(locale), {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(portalLocale(locale))} ${currency}`;
  }
}

export function personInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function nextActionHref(action: StudentPortalNextAction) {
  if (action.labelKey === "portalNextDocument") return "/portal/documents";
  if (action.labelKey === "portalNextDeadline") return "/portal/applications";
  if (action.labelKey === "portalNextPayment" || action.labelKey === "portalNextOverduePayment") {
    return "/portal/payments";
  }
  if (action.labelKey === "portalNextVisa") return "/portal/visa";
  return "/portal/notifications";
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function statusTone(value: string): Tone {
  if (value === "info") return "info";
  if (["approved", "paid", "enrolled", "done", "complete"].includes(value)) return "success";
  if (["rejected", "overdue", "urgent"].includes(value)) return "danger";
  if (["required", "review", "pending", "high", "warning", "appointment"].includes(value)) {
    return "warning";
  }
  if (["uploaded", "submitted", "offer", "in_progress", "normal", "docs"].includes(value)) {
    return "info";
  }
  return "neutral";
}

export function PortalStatusBadge({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const tone = statusTone(value);
  const toneClass = {
    neutral: styles.toneNeutral,
    success: styles.toneSuccess,
    warning: styles.toneWarning,
    danger: styles.toneDanger,
    info: styles.toneInfo,
  }[tone];
  return <span className={`${styles.statusBadge} ${toneClass}`}>{label}</span>;
}

export function PortalPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        <p className={styles.pageDescription}>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function PortalPanel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${styles.panelPadding} ${className}`}>
      {(title || action) && (
        <div className={styles.panelTitleRow}>
          {title ? <h2 className={styles.panelTitle}>{title}</h2> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PortalNotice({
  title,
  body,
  tone = "info",
}: {
  title: string;
  body: string;
  tone?: "info" | "warning" | "danger";
}) {
  const toneClass = tone === "danger" ? styles.noticeDanger : tone === "warning" ? styles.noticeWarning : "";
  return (
    <aside className={`${styles.notice} ${toneClass}`}>
      <PortalIcon name={tone === "danger" ? "alert" : "info"} size={19} />
      <div>
        <div className={styles.noticeTitle}>{title}</div>
        <div className={styles.noticeBody}>{body}</div>
      </div>
    </aside>
  );
}

export function PortalEmptyState({
  icon,
  title,
  body,
}: {
  icon: PortalIconName;
  title: string;
  body: string;
}) {
  return (
    <div className={styles.emptyState}>
      <div>
        <span className={styles.emptyIcon}>
          <PortalIcon name={icon} size={23} />
        </span>
        <div className={styles.emptyTitle}>{title}</div>
        <p className={styles.emptyBody}>{body}</p>
      </div>
    </div>
  );
}

export function PortalMissingCase({ copy }: { copy: PortalCopy }) {
  return (
    <div className={styles.statusPage}>
      <section className={styles.statusCard}>
        <span className={styles.statusIcon}>
          <PortalIcon name="shield" size={27} />
        </span>
        <h1 className={styles.statusTitle}>{copy.caseUnavailableTitle}</h1>
        <p className={styles.statusBody}>{copy.caseUnavailableBody}</p>
        <div className={styles.statusActions}>
          <a href="mailto:info@evoadmissions.com" className={styles.button}>
            <PortalIcon name="mail" size={17} />
            {copy.contactSupport}
          </a>
        </div>
      </section>
    </div>
  );
}

export function PortalContactCard({
  contact,
  roleLabel,
  copy,
  compact = false,
}: {
  contact: StudentPortalContact;
  roleLabel: string;
  copy: PortalCopy;
  compact?: boolean;
}) {
  return (
    <article className={compact ? undefined : styles.teamCard}>
      <div className={styles.personRow}>
        <span className={styles.personAvatar} aria-hidden="true">
          {personInitials(contact.name)}
        </span>
        <div>
          <div className={styles.personName}>{contact.name}</div>
          <div className={styles.personRole}>{roleLabel}</div>
        </div>
      </div>
      {!compact && (
        <div className={styles.teamActions}>
          <a href={`mailto:${contact.email}`} className={styles.buttonSecondary}>
            <PortalIcon name="mail" size={16} />
            {copy.contactByEmail}
          </a>
          {contact.phone && (
            <a href={`tel:${contact.phone}`} className={styles.buttonSecondary}>
              <PortalIcon name="phone" size={16} />
              {copy.contactByPhone}
            </a>
          )}
        </div>
      )}
    </article>
  );
}

export function PortalHelpActions({
  snapshot,
  copy,
}: {
  snapshot: StudentPortalSnapshot;
  copy: PortalCopy;
}) {
  const contact = snapshot.curator ?? snapshot.manager;
  if (!contact) return null;
  return (
    <div className={styles.teamActions}>
      <a href={`mailto:${contact.email}`} className={styles.buttonSecondary}>
        <PortalIcon name="mail" size={16} />
        {copy.contactByEmail}
      </a>
      {contact.phone && (
        <a href={`tel:${contact.phone}`} className={styles.buttonSecondary}>
          <PortalIcon name="phone" size={16} />
          {copy.contactByPhone}
        </a>
      )}
      <Link href="/portal/team" className={styles.buttonSecondary}>
        <PortalIcon name="team" size={16} />
        {copy.team}
      </Link>
    </div>
  );
}

export { styles as portalStyles };
