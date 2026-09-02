import Link from "next/link";

import { Icon } from "@/components/icons";
import { PageHeader, btnGhostCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { PlatformSalesLeadDetail } from "@/lib/platform-sales";

import {
  CanonicalKeyBadge,
  CanonicalUuid,
  formatCanonicalTimestamp,
} from "./CanonicalRecordsPresentation";

const COPY = {
  ru: {
    back: "К лидам",
    description:
      "Основная карточка лида из канонической модели Supabase Platform.",
    leadId: "Lead UUID",
    clientId: "Client UUID",
    email: "Эл. почта",
    phone: "Телефон",
    stage: "Текущий этап EVO",
    owner: "Текущий ответственный",
    ownerMembershipId: "Membership UUID ответственного",
    noOwner: "Не назначен",
    lifecycle: "Состояние лида",
    nextAction: "Следующее действие",
    nextActionDueDate: "Дата следующего действия",
    source: "Ключ источника",
    workflowVersion: "Версия Sales workflow",
    createdAt: "Создано",
    updatedAt: "Обновлено",
  },
  ky: {
    back: "Лиддерге",
    description:
      "Supabase Platform каноникалык моделиндеги лиддин негизги карточкасы.",
    leadId: "Lead UUID",
    clientId: "Client UUID",
    email: "Эл. почта",
    phone: "Телефон",
    stage: "EVO учурдагы этабы",
    owner: "Учурдагы жооптуу",
    ownerMembershipId: "Жооптуунун Membership UUID'си",
    noOwner: "Дайындалган эмес",
    lifecycle: "Лиддин абалы",
    nextAction: "Кийинки аракет",
    nextActionDueDate: "Кийинки аракеттин датасы",
    source: "Булак ачкычы",
    workflowVersion: "Sales workflow версиясы",
    createdAt: "Түзүлгөн",
    updatedAt: "Жаңыртылган",
  },
  en: {
    back: "Back to leads",
    description:
      "The primary lead card from the canonical Supabase Platform model.",
    leadId: "Lead UUID",
    clientId: "Client UUID",
    email: "Email",
    phone: "Phone",
    stage: "Current EVO stage",
    owner: "Current owner",
    ownerMembershipId: "Owner membership UUID",
    noOwner: "Unassigned",
    lifecycle: "Lead lifecycle",
    nextAction: "Next action",
    nextActionDueDate: "Next-action date",
    source: "Source key",
    workflowVersion: "Sales workflow version",
    createdAt: "Created",
    updatedAt: "Updated",
  },
} as const;

export function CanonicalLeadDetail({
  lead,
  locale,
}: Readonly<{
  lead: PlatformSalesLeadDetail;
  locale: Locale;
}>) {
  const copy = COPY[locale];

  return (
    <div className="min-w-0 space-y-5" data-testid="canonical-lead-detail">
      <Link href="/sales" className={cn(btnGhostCls, "w-fit gap-1")}>
        <Icon name="arrow-left" size={15} /> {copy.back}
      </Link>

      <PageHeader
        title={lead.clientDisplayName ?? lead.clientEmail ?? lead.clientPhone ?? lead.leadId}
        description={copy.description}
      />

      <section className="rounded-card border border-border bg-surface-2 px-5 py-4">
        <p className="text-sm text-fg-2">
          {locale === "ru"
            ? "Источник данных: Supabase, каноническая схема Platform и права RLS текущего сотрудника."
            : locale === "ky"
              ? "Маалымат булагы: Supabase, каноникалык Platform схемасы жана учурдагы кызматкердин RLS укуктары."
              : "Data source: Supabase, the canonical Platform schema, and the current staff member's RLS permissions."}
        </p>
      </section>

      <section className="rounded-card border border-border bg-surface px-5 py-4">
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Fact label={copy.leadId} testId="canonical-lead-id">
            <CanonicalUuid value={lead.leadId} />
          </Fact>
          <Fact label={copy.clientId} testId="canonical-client-id">
            {lead.clientId ? <CanonicalUuid value={lead.clientId} /> : "—"}
          </Fact>
          <Fact label={copy.email}>{lead.clientEmail ?? "—"}</Fact>
          <Fact label={copy.phone} testId="canonical-lead-phone">
            {lead.clientPhone ?? "—"}
          </Fact>
          <Fact label={copy.stage} testId="canonical-lead-stage">
            <CanonicalKeyBadge value={lead.stageKey} />
          </Fact>
          <Fact label={copy.owner}>
            {lead.currentOwnerDisplayName ?? copy.noOwner}
          </Fact>
          <Fact label={copy.ownerMembershipId}>
            {lead.currentOwnerMembershipId ? (
              <CanonicalUuid value={lead.currentOwnerMembershipId} />
            ) : (
              "—"
            )}
          </Fact>
          <Fact label={copy.lifecycle}>
            <CanonicalKeyBadge value={lead.lifecycleState} />
          </Fact>
          <Fact label={copy.nextAction}>{lead.nextActionText ?? "—"}</Fact>
          <Fact label={copy.nextActionDueDate}>
            {lead.nextActionDueDate ? (
              <span className="font-mono text-xs">
                {formatCalendarDate(lead.nextActionDueDate, locale)}
              </span>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label={copy.source} testId="canonical-lead-source">
            <CanonicalKeyBadge value={lead.sourceKey} />
          </Fact>
          <Fact label={copy.workflowVersion} testId="canonical-lead-workflow-version">
            <span className="font-mono text-xs text-fg">{lead.workflowVersion}</span>
          </Fact>
          <Fact label={copy.createdAt}>
            <span className="font-mono text-xs">
              {formatCanonicalTimestamp(lead.createdAt, locale)}
            </span>
          </Fact>
          <Fact label={copy.updatedAt}>
            <span className="font-mono text-xs">
              {formatCanonicalTimestamp(lead.updatedAt, locale)}
            </span>
          </Fact>
        </dl>
      </section>
    </div>
  );
}

function formatCalendarDate(value: string, locale: Locale): string {
  const localeTag = locale === "ru" ? "ru-RU" : locale === "ky" ? "ky-KG" : "en-US";
  return new Intl.DateTimeFormat(localeTag, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function Fact({
  label,
  children,
  testId,
}: Readonly<{
  label: string;
  children: React.ReactNode;
  testId?: string;
}>) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm text-fg-2">{children}</dd>
    </div>
  );
}
