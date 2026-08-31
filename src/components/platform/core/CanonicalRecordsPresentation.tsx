import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";

const LOCALE_TAG: Record<Locale, string> = {
  ru: "ru-RU",
  ky: "ky-KG",
  en: "en-US",
};

export const CANONICAL_RECORD_COPY = {
  ru: {
    authorityTitle: "Источник истины — EVO",
    authorityBody:
      "Личность, текущий этап и ответственный читаются из канонической модели EVO в локальной PostgreSQL V2. Внешние ID, переписка и Student Case показаны только как связанный контекст, а не как второй источник истины.",
    readOnly: "Только чтение в текущем срезе",
    canonicalId: "EVO UUID",
    externalIdentifiers: "Внешние идентификаторы",
    provenance: "Происхождение данных",
    linkedContext: "Связанный контекст",
    secondaryContext: "вторичный контекст",
    evoLead: "Лид EVO",
    studentCase: "Student Case",
    conversation: "Диалог",
    duplicateStatus: "Статус дублей",
    duplicatesOpen: "Есть кандидаты на дубль",
    duplicatesClear: "Открытых кандидатов нет",
    observedAt: "Зафиксировано",
    importedAt: "Импортировано",
    recordedAt: "Записано в EVO",
    sourceReference: "Ссылка на источник",
    noExternalIdentifiers: "Внешние идентификаторы не зафиксированы.",
    noProvenance: "Безопасные записи происхождения пока не зафиксированы.",
    noLinkedContext: "Связанный контекст пока не зафиксирован.",
    unavailable: "Не указано",
    updatedAt: "Обновлено",
  },
  ky: {
    authorityTitle: "Чындыктын булагы — EVO",
    authorityBody:
      "Инсан, учурдагы этап жана жооптуу кызматкер жергиликтүү PostgreSQL V2деги EVO каноникалык моделинен окулат. Тышкы ID, кат алышуу жана Student Case экинчи чындык булагы эмес, байланышкан контекст катары гана көрсөтүлөт.",
    readOnly: "Учурдагы кесимде окуу гана",
    canonicalId: "EVO UUID",
    externalIdentifiers: "Тышкы идентификаторлор",
    provenance: "Маалыматтын келип чыгышы",
    linkedContext: "Байланышкан контекст",
    secondaryContext: "кошумча контекст",
    evoLead: "EVO лиди",
    studentCase: "Student Case",
    conversation: "Диалог",
    duplicateStatus: "Дубликаттардын абалы",
    duplicatesOpen: "Дубликат болушу мүмкүн",
    duplicatesClear: "Ачык дубликат талапкерлери жок",
    observedAt: "Катталган",
    importedAt: "Импорттолгон",
    recordedAt: "EVOдо жазылган",
    sourceReference: "Булак шилтемеси",
    noExternalIdentifiers: "Тышкы идентификаторлор катталган эмес.",
    noProvenance: "Коопсуз келип чыгуу жазуулары азырынча жок.",
    noLinkedContext: "Байланышкан контекст азырынча жок.",
    unavailable: "Көрсөтүлгөн эмес",
    updatedAt: "Жаңыртылды",
  },
  en: {
    authorityTitle: "Source of truth — EVO",
    authorityBody:
      "Identity, current stage, and owner come from EVO's local PostgreSQL V2 canonical model. External IDs, conversations, and Student Cases are shown only as linked context, not as a second source of truth.",
    readOnly: "Read-only in this runtime",
    canonicalId: "EVO UUID",
    externalIdentifiers: "External identifiers",
    provenance: "Data provenance",
    linkedContext: "Linked context",
    secondaryContext: "secondary context",
    evoLead: "EVO lead",
    studentCase: "Student Case",
    conversation: "Conversation",
    duplicateStatus: "Duplicate status",
    duplicatesOpen: "Duplicate candidates need review",
    duplicatesClear: "No open duplicate candidates",
    observedAt: "Observed",
    importedAt: "Imported",
    recordedAt: "Recorded in EVO",
    sourceReference: "Source reference",
    noExternalIdentifiers: "No external identifiers are recorded.",
    noProvenance: "No safe provenance records are available yet.",
    noLinkedContext: "No linked context is recorded yet.",
    unavailable: "Not specified",
    updatedAt: "Updated",
  },
} as const;

export function canonicalRecordCopy(locale: Locale) {
  return CANONICAL_RECORD_COPY[locale];
}

export function formatCanonicalTimestamp(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function humanizeCanonicalKey(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function CanonicalAuthorityNotice({
  locale,
}: Readonly<{ locale: Locale }>) {
  const copy = canonicalRecordCopy(locale);
  return (
    <aside
      className="flex gap-3 border-l-[3px] border-accent bg-accent-weak/45 px-4 py-3"
      data-testid="canonical-evo-authority"
    >
      <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[13px] font-semibold text-fg">
            {copy.authorityTitle}
          </h2>
          <span className="rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-fg-3">
            {copy.readOnly}
          </span>
        </div>
        <p className="mt-1 max-w-4xl text-[12.5px] leading-5 text-fg-2">
          {copy.authorityBody}
        </p>
      </div>
    </aside>
  );
}

export function CanonicalKeyBadge({
  value,
  tone = "neutral",
}: Readonly<{
  value: string;
  tone?: "neutral" | "accent" | "ok" | "warn" | "danger";
}>) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold leading-4",
        tone === "accent" && "bg-accent-weak text-accent",
        tone === "ok" && "bg-ok-weak text-ok",
        tone === "warn" && "bg-warn-weak text-warn",
        tone === "danger" && "bg-danger-weak text-danger",
        tone === "neutral" && "bg-surface-2 text-fg-2",
      )}
    >
      {humanizeCanonicalKey(value)}
    </span>
  );
}

export function CanonicalUuid({ value }: Readonly<{ value: string }>) {
  return (
    <span className="break-all font-mono text-[11px] text-fg-3">{value}</span>
  );
}

export function CanonicalSection({
  title,
  children,
  testId,
}: Readonly<{
  title: string;
  children: ReactNode;
  testId?: string;
}>) {
  return (
    <section
      className="border-t border-border pt-4"
      data-testid={testId}
      aria-label={title}
    >
      <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function DuplicateStatus({
  count,
  locale,
}: Readonly<{ count: number; locale: Locale }>) {
  const copy = canonicalRecordCopy(locale);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
        count > 0 ? "bg-warn-weak text-warn" : "bg-ok-weak text-ok",
      )}
      data-testid="canonical-duplicate-status"
    >
      {count > 0 ? `${copy.duplicatesOpen}: ${count}` : copy.duplicatesClear}
    </span>
  );
}
