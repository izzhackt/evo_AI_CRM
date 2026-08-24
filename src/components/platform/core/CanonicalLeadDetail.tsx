import Link from "next/link";

import { Icon } from "@/components/icons";
import { PageHeader, btnGhostCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { PlatformCanonicalLeadDetail } from "@/lib/platform-canonical-records";

import {
  CanonicalExternalIdentifiers,
  CanonicalLinkedContext,
  CanonicalProvenanceList,
} from "./CanonicalRecordEvidence";
import {
  CanonicalAuthorityNotice,
  CanonicalKeyBadge,
  CanonicalUuid,
  DuplicateStatus,
  canonicalRecordCopy,
  formatCanonicalTimestamp,
  humanizeCanonicalKey,
} from "./CanonicalRecordsPresentation";

const COPY = {
  ru: {
    back: "К лидам",
    eyebrow: "Канонический лид EVO",
    fallbackName: "Лид без связанного клиента",
    description: "Каноническая запись EVO и связанный контекст только для чтения.",
    identity: "Каноническая запись",
    client: "Клиент EVO",
    email: "Эл. почта",
    phone: "Телефон",
    stage: "Текущий этап EVO",
    owner: "Текущий ответственный EVO",
    source: "Источник лида",
    lifecycle: "Состояние записи",
    notAssigned: "Не назначен",
    noClient: "Канонический клиент не связан",
  },
  ky: {
    back: "Лиддерге",
    eyebrow: "EVO каноникалык лиди",
    fallbackName: "Кардарга байланыша элек лид",
    description: "EVO каноникалык жазуусу жана окуу үчүн гана байланышкан контекст.",
    identity: "Каноникалык жазуу",
    client: "EVO кардары",
    email: "Эл. почта",
    phone: "Телефон",
    stage: "EVO учурдагы этабы",
    owner: "EVO учурдагы жооптуусу",
    source: "Лид булагы",
    lifecycle: "Жазуунун абалы",
    notAssigned: "Дайындалган эмес",
    noClient: "Каноникалык кардар байланыша элек",
  },
  en: {
    back: "Back to leads",
    eyebrow: "Canonical EVO lead",
    fallbackName: "Lead without a linked client",
    description: "The canonical EVO record and linked read-only context.",
    identity: "Canonical record",
    client: "EVO client",
    email: "Email",
    phone: "Phone",
    stage: "Current EVO stage",
    owner: "Current EVO owner",
    source: "Lead source",
    lifecycle: "Record lifecycle",
    notAssigned: "Not assigned",
    noClient: "No canonical client is linked",
  },
} as const;

export function CanonicalLeadDetail({
  lead,
  locale,
}: Readonly<{
  lead: PlatformCanonicalLeadDetail;
  locale: Locale;
}>) {
  const copy = COPY[locale];
  const shared = canonicalRecordCopy(locale);
  const displayName = lead.clientDisplayName ?? copy.fallbackName;

  return (
    <div className="min-w-0 space-y-5" data-testid="canonical-lead-detail">
      <Link href="/sales" className={cn(btnGhostCls, "w-fit gap-1")}>
        <Icon name="arrow-left" size={15} /> {copy.back}
      </Link>

      <PageHeader
        eyebrow={copy.eyebrow}
        title={displayName}
        description={copy.description}
        action={<CanonicalKeyBadge value={lead.lifecycleState} tone="accent" />}
      />

      <CanonicalAuthorityNotice locale={locale} />

      <section
        className="border-y border-border py-4"
        aria-labelledby="canonical-lead-record-title"
      >
        <h2
          id="canonical-lead-record-title"
          className="text-[13px] font-semibold text-fg"
        >
          {copy.identity}
        </h2>
        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={shared.canonicalId} testId="canonical-lead-id">
            <CanonicalUuid value={lead.id} />
          </Fact>
          <Fact label={copy.client} testId="canonical-lead-client">
            {lead.clientId ? (
              <span>
                <Link
                  href={`/clients/${lead.clientId}`}
                  className="font-semibold text-accent hover:underline"
                >
                  {lead.clientDisplayName}
                </Link>
                <span className="mt-1 block">
                  <CanonicalUuid value={lead.clientId} />
                </span>
              </span>
            ) : (
              copy.noClient
            )}
          </Fact>
          <Fact label={copy.stage} testId="canonical-lead-stage">
            <span data-stage-key={lead.stageKey}>
              <CanonicalKeyBadge value={lead.stageKey} tone="accent" />
            </span>
          </Fact>
          <Fact label={copy.owner} testId="canonical-lead-owner">
            <span className="font-semibold text-fg">
              {lead.currentOwnerDisplayName ?? copy.notAssigned}
            </span>
            {lead.currentOwnerMembershipId ? (
              <span className="mt-1 block">
                <CanonicalUuid value={lead.currentOwnerMembershipId} />
              </span>
            ) : null}
          </Fact>
          <Fact label={copy.email}>{lead.clientEmail ?? shared.unavailable}</Fact>
          <Fact label={copy.phone}>{lead.clientPhone ?? shared.unavailable}</Fact>
          <Fact label={copy.source}>
            {humanizeCanonicalKey(lead.sourceKey)}
          </Fact>
          <Fact label={copy.lifecycle}>
            <CanonicalKeyBadge value={lead.lifecycleState} />
          </Fact>
          <Fact label={shared.duplicateStatus}>
            <DuplicateStatus
              count={lead.openDuplicateCandidateCount}
              locale={locale}
            />
          </Fact>
          <Fact label={shared.updatedAt}>
            <span className="font-mono text-[11.5px]">
              {formatCanonicalTimestamp(lead.updatedAt, locale)}
            </span>
          </Fact>
        </dl>
      </section>

      <CanonicalExternalIdentifiers
        items={lead.externalIdentifiers}
        locale={locale}
      />
      <CanonicalProvenanceList items={lead.provenance} locale={locale} />
      <CanonicalLinkedContext
        locale={locale}
        studentCases={lead.linkedStudentCases}
        conversations={lead.linkedConversations}
        conversationHrefPrefix={`/sales/${lead.id}/conversations`}
      />
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
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-[12.5px] text-fg-2">{children}</dd>
    </div>
  );
}
