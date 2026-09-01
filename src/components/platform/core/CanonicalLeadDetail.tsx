import Link from "next/link";

import { Icon } from "@/components/icons";
import { PageHeader, btnGhostCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { CanonicalLeadSnapshot } from "@/lib/server/canonical-crm-repository";

import {
  CanonicalKeyBadge,
  CanonicalUuid,
  formatCanonicalTimestamp,
} from "./CanonicalRecordsPresentation";

const COPY = {
  ru: {
    back: "К лидам",
    description:
      "Это основная карточка лида в V2. Здесь показаны текущие данные лида, по которым работает CRM.",
    leadId: "Lead UUID",
    personId: "Person UUID",
    email: "Эл. почта",
    phone: "Телефон",
    stage: "Текущий этап EVO",
    owner: "Роль-владелец",
    qualificationSummary: "Итог квалификации",
    nextAction: "Следующее действие",
    nextActionAt: "Срок следующего действия",
    source: "Источник лида",
    version: "Версия записи",
    createdAt: "Создано",
    updatedAt: "Обновлено",
  },
  ky: {
    back: "Лиддерге",
    description:
      "Бул V2деги лиддин негизги карточкасы. Бул жерде CRM иштеген учурдагы лид маалыматтары көрсөтүлөт.",
    leadId: "Lead UUID",
    personId: "Person UUID",
    email: "Эл. почта",
    phone: "Телефон",
    stage: "EVO учурдагы этабы",
    owner: "Ээ роль",
    qualificationSummary: "Квалификация жыйынтыгы",
    nextAction: "Кийинки аракет",
    nextActionAt: "Кийинки аракеттин мөөнөтү",
    source: "Лид булагы",
    version: "Жазуунун версиясы",
    createdAt: "Түзүлгөн",
    updatedAt: "Жаңыртылган",
  },
  en: {
    back: "Back to leads",
    description:
      "This is the primary lead card in V2. It shows the current lead data the CRM works from.",
    leadId: "Lead UUID",
    personId: "Person UUID",
    email: "Email",
    phone: "Phone",
    stage: "Current EVO stage",
    owner: "Owner role",
    qualificationSummary: "Qualification summary",
    nextAction: "Next action",
    nextActionAt: "Next-action deadline",
    source: "Lead source",
    version: "Record version",
    createdAt: "Created",
    updatedAt: "Updated",
  },
} as const;

export function CanonicalLeadDetail({
  lead,
  locale,
}: Readonly<{
  lead: CanonicalLeadSnapshot;
  locale: Locale;
}>) {
  const copy = COPY[locale];

  return (
    <div className="min-w-0 space-y-5" data-testid="canonical-lead-detail">
      <Link href="/sales" className={cn(btnGhostCls, "w-fit gap-1")}>
        <Icon name="arrow-left" size={15} /> {copy.back}
      </Link>

      <PageHeader
        title={lead.displayName}
        description={copy.description}
      />

      <section className="rounded-card border border-border bg-surface-2 px-5 py-4">
        <p className="text-sm text-fg-2">
          {locale === "ru"
            ? "Источник данных: текущая база EVO V2."
            : locale === "ky"
              ? "Маалымат булагы: EVO V2нин учурдагы базасы."
              : "Data source: the current EVO V2 database."}
        </p>
      </section>

      <section className="rounded-card border border-border bg-surface px-5 py-4">
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Fact label={copy.leadId} testId="canonical-lead-id">
            <CanonicalUuid value={lead.leadId} />
          </Fact>
          <Fact label={copy.personId} testId="canonical-person-id">
            <CanonicalUuid value={lead.personId} />
          </Fact>
          <Fact label={copy.email}>{lead.email ?? "—"}</Fact>
          <Fact label={copy.phone}>{lead.phone ?? "—"}</Fact>
          <Fact label={copy.stage}>
            <CanonicalKeyBadge value={lead.stage} />
          </Fact>
          <Fact label={copy.owner}>
            <CanonicalKeyBadge value={lead.ownerRole} />
          </Fact>
          <Fact label={copy.qualificationSummary}>
            {lead.qualificationSummary ?? "—"}
          </Fact>
          <Fact label={copy.nextAction}>{lead.nextAction ?? "—"}</Fact>
          <Fact label={copy.nextActionAt}>
            {lead.nextActionAt ? (
              <span className="font-mono text-xs">
                {formatCanonicalTimestamp(lead.nextActionAt, locale)}
              </span>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label={copy.source}>
            <span className="font-medium text-fg">{lead.source}</span>
          </Fact>
          <Fact label={copy.version}>
            <span className="font-mono text-xs text-fg">{lead.version}</span>
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
