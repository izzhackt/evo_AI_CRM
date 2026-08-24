import Link from "next/link";

import { Icon } from "@/components/icons";
import { PageHeader, btnGhostCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { PlatformCanonicalClientDetail } from "@/lib/platform-canonical-records";

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
} from "./CanonicalRecordsPresentation";

const COPY = {
  ru: {
    back: "К клиентам",
    eyebrow: "Канонический клиент EVO",
    description:
      "Единая личность клиента в EVO. Лиды и операционные модули ниже показаны как связанные записи.",
    identity: "Каноническая личность",
    email: "Эл. почта",
    phone: "Телефон",
    lifecycle: "Состояние записи",
    linkedLeads: "Связанные лиды",
    linkedCases: "Связанные Student Cases",
    linkedConversations: "Связанные диалоги",
  },
  ky: {
    back: "Кардарларга",
    eyebrow: "EVO каноникалык кардары",
    description:
      "EVOдогу кардардын бирдиктүү инсандык жазуусу. Төмөндө лиддер жана операциялык модулдар байланышкан жазуулар катары көрсөтүлгөн.",
    identity: "Каноникалык инсан",
    email: "Эл. почта",
    phone: "Телефон",
    lifecycle: "Жазуунун абалы",
    linkedLeads: "Байланышкан лиддер",
    linkedCases: "Байланышкан Student Cases",
    linkedConversations: "Байланышкан диалогдор",
  },
  en: {
    back: "Back to clients",
    eyebrow: "Canonical EVO client",
    description:
      "The single EVO client identity. Leads and operational modules below are linked records.",
    identity: "Canonical identity",
    email: "Email",
    phone: "Phone",
    lifecycle: "Record lifecycle",
    linkedLeads: "Linked leads",
    linkedCases: "Linked Student Cases",
    linkedConversations: "Linked conversations",
  },
} as const;

export function CanonicalClientDetail({
  client,
  locale,
}: Readonly<{
  client: PlatformCanonicalClientDetail;
  locale: Locale;
}>) {
  const copy = COPY[locale];
  const shared = canonicalRecordCopy(locale);

  return (
    <div className="min-w-0 space-y-5" data-testid="canonical-client-detail">
      <Link href="/clients" className={cn(btnGhostCls, "w-fit gap-1")}>
        <Icon name="arrow-left" size={15} /> {copy.back}
      </Link>

      <PageHeader
        eyebrow={copy.eyebrow}
        title={client.displayName}
        description={copy.description}
        action={<CanonicalKeyBadge value={client.lifecycleState} tone="accent" />}
      />

      <CanonicalAuthorityNotice locale={locale} />

      <section
        className="border-y border-border py-4"
        aria-labelledby="canonical-client-record-title"
      >
        <h2
          id="canonical-client-record-title"
          className="text-[13px] font-semibold text-fg"
        >
          {copy.identity}
        </h2>
        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={shared.canonicalId} testId="canonical-client-id">
            <CanonicalUuid value={client.id} />
          </Fact>
          <Fact label={copy.email}>{client.email ?? shared.unavailable}</Fact>
          <Fact label={copy.phone}>{client.phone ?? shared.unavailable}</Fact>
          <Fact label={copy.lifecycle}>
            <CanonicalKeyBadge value={client.lifecycleState} />
          </Fact>
          <Fact label={copy.linkedLeads}>{client.linkedLeadCount}</Fact>
          <Fact label={copy.linkedCases}>{client.linkedStudentCaseCount}</Fact>
          <Fact label={copy.linkedConversations}>
            {client.linkedConversationCount}
          </Fact>
          <Fact label={shared.duplicateStatus}>
            <DuplicateStatus
              count={client.openDuplicateCandidateCount}
              locale={locale}
            />
          </Fact>
          <Fact label={shared.updatedAt}>
            <span className="font-mono text-[11.5px]">
              {formatCanonicalTimestamp(client.updatedAt, locale)}
            </span>
          </Fact>
        </dl>
      </section>

      <CanonicalExternalIdentifiers
        items={client.externalIdentifiers}
        locale={locale}
      />
      <CanonicalProvenanceList items={client.provenance} locale={locale} />
      <CanonicalLinkedContext
        locale={locale}
        leads={client.linkedLeads}
        studentCases={client.linkedStudentCases}
        conversations={client.linkedConversations}
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
