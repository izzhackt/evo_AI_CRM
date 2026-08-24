import Link from "next/link";

import {
  CanonicalKeyBadge,
  CanonicalSection,
  CanonicalUuid,
  canonicalRecordCopy,
  formatCanonicalTimestamp,
  humanizeCanonicalKey,
} from "./CanonicalRecordsPresentation";
import type { Locale } from "@/lib/i18n";
import type {
  PlatformCanonicalExternalIdentifier,
  PlatformCanonicalLinkedConversation,
  PlatformCanonicalLinkedLead,
  PlatformCanonicalLinkedStudentCase,
  PlatformCanonicalProvenance,
} from "@/lib/platform-canonical-records";

export function CanonicalExternalIdentifiers({
  items,
  locale,
}: Readonly<{
  items: readonly PlatformCanonicalExternalIdentifier[];
  locale: Locale;
}>) {
  const copy = canonicalRecordCopy(locale);
  return (
    <CanonicalSection
      title={copy.externalIdentifiers}
      testId="canonical-external-identifiers"
    >
      {items.length === 0 ? (
        <p className="text-[12.5px] text-fg-3">
          {copy.noExternalIdentifiers}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li
              key={item.id}
              className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.65fr)]"
              data-testid="canonical-external-identifier"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CanonicalKeyBadge value={item.sourceSystem} tone="accent" />
                  <span className="text-[12px] font-medium text-fg-2">
                    {humanizeCanonicalKey(item.externalObjectType)}
                  </span>
                </div>
                <div className="mt-2 break-all font-mono text-[12px] font-semibold text-fg">
                  {item.externalIdentifier}
                </div>
                {item.sourceRef ? (
                  <div className="mt-1 break-all text-[11.5px] text-fg-3">
                    {copy.sourceReference}: {item.sourceRef}
                  </div>
                ) : null}
              </div>
              <dl className="grid content-start gap-1 text-[11.5px] text-fg-3 sm:text-right">
                <div>
                  <dt className="inline font-medium">{copy.observedAt}: </dt>
                  <dd className="inline font-mono">
                    {formatCanonicalTimestamp(item.observedAt, locale)}
                  </dd>
                </div>
                {item.importedAt ? (
                  <div>
                    <dt className="inline font-medium">{copy.importedAt}: </dt>
                    <dd className="inline font-mono">
                      {formatCanonicalTimestamp(item.importedAt, locale)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </CanonicalSection>
  );
}

export function CanonicalProvenanceList({
  items,
  locale,
}: Readonly<{
  items: readonly PlatformCanonicalProvenance[];
  locale: Locale;
}>) {
  const copy = canonicalRecordCopy(locale);
  return (
    <CanonicalSection title={copy.provenance} testId="canonical-provenance">
      {items.length === 0 ? (
        <p className="text-[12.5px] text-fg-3">{copy.noProvenance}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li
              key={item.id}
              className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.65fr)]"
              data-testid="canonical-provenance-item"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CanonicalKeyBadge value={item.sourceSystem} tone="accent" />
                  <span className="text-[12px] font-medium text-fg-2">
                    {humanizeCanonicalKey(item.evidenceType)}
                  </span>
                </div>
                {item.sourceRef ? (
                  <div className="mt-2 break-all text-[11.5px] text-fg-3">
                    {copy.sourceReference}: {item.sourceRef}
                  </div>
                ) : null}
              </div>
              <dl className="grid content-start gap-1 text-[11.5px] text-fg-3 sm:text-right">
                <div>
                  <dt className="inline font-medium">{copy.observedAt}: </dt>
                  <dd className="inline font-mono">
                    {formatCanonicalTimestamp(item.observedAt, locale)}
                  </dd>
                </div>
                {item.importedAt ? (
                  <div>
                    <dt className="inline font-medium">{copy.importedAt}: </dt>
                    <dd className="inline font-mono">
                      {formatCanonicalTimestamp(item.importedAt, locale)}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="inline font-medium">{copy.recordedAt}: </dt>
                  <dd className="inline font-mono">
                    {formatCanonicalTimestamp(item.recordedAt, locale)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </CanonicalSection>
  );
}

export function CanonicalLinkedContext({
  locale,
  studentCases,
  conversations,
  leads = [],
  conversationHrefPrefix,
}: Readonly<{
  locale: Locale;
  studentCases: readonly PlatformCanonicalLinkedStudentCase[];
  conversations: readonly PlatformCanonicalLinkedConversation[];
  leads?: readonly PlatformCanonicalLinkedLead[];
  conversationHrefPrefix: string | null;
}>) {
  const copy = canonicalRecordCopy(locale);
  const empty =
    studentCases.length === 0 && conversations.length === 0 && leads.length === 0;
  return (
    <CanonicalSection title={copy.linkedContext} testId="canonical-linked-context">
      {empty ? (
        <p className="text-[12.5px] text-fg-3">{copy.noLinkedContext}</p>
      ) : (
        <div className="divide-y divide-border">
          {leads.map((lead) => (
            <div
              key={`lead-${lead.id}`}
              className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]"
              data-testid="canonical-linked-lead"
            >
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                  {copy.evoLead} · {copy.secondaryContext}
                </div>
                <Link
                  href={`/sales/${lead.id}`}
                  className="mt-1 inline-block font-semibold text-accent hover:underline"
                >
                  {humanizeCanonicalKey(lead.stageKey)}
                </Link>
                <div className="mt-1">
                  <CanonicalUuid value={lead.id} />
                </div>
              </div>
              <div className="text-[11.5px] text-fg-3 sm:text-right">
                <div>{lead.currentOwnerDisplayName ?? copy.unavailable}</div>
                <div className="mt-1 font-mono">
                  {formatCanonicalTimestamp(lead.updatedAt, locale)}
                </div>
              </div>
            </div>
          ))}
          {studentCases.map((studentCase) => (
            <div
              key={`case-${studentCase.id}`}
              className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]"
              data-testid="canonical-linked-student-case"
            >
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                  {copy.studentCase} · {copy.secondaryContext}
                </div>
                <Link
                  href={`/clients/${studentCase.id}`}
                  className="mt-1 inline-block font-semibold text-accent hover:underline"
                >
                  {studentCase.studentDisplayName}
                </Link>
                <div className="mt-1">
                  <CanonicalUuid value={studentCase.id} />
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2 sm:justify-end">
                <CanonicalKeyBadge value={studentCase.operationalStage} />
                <CanonicalKeyBadge value={studentCase.state} />
              </div>
            </div>
          ))}
          {conversations.map((conversation) => (
            <div
              key={`conversation-${conversation.id}`}
              className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]"
              data-testid="canonical-linked-conversation"
            >
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                  {copy.conversation} · {copy.secondaryContext}
                </div>
                {conversationHrefPrefix ? (
                  <Link
                    href={`${conversationHrefPrefix}/${conversation.id}`}
                    className="mt-1 inline-block font-semibold text-accent hover:underline"
                  >
                    {conversation.subject}
                  </Link>
                ) : (
                  <span
                    className="mt-1 inline-block font-semibold text-fg"
                    data-testid="canonical-linked-conversation-read-only"
                  >
                    {conversation.subject}
                  </span>
                )}
                <div className="mt-1">
                  <CanonicalUuid value={conversation.id} />
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2 sm:justify-end">
                <CanonicalKeyBadge value={conversation.queue} />
                <CanonicalKeyBadge
                  value={conversation.status}
                  tone={conversation.status === "open" ? "ok" : "neutral"}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </CanonicalSection>
  );
}
