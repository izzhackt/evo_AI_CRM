import Link from "next/link";

import { Card } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import { getT } from "@/lib/i18n";
import { requirePlatformDocumentsActor } from "@/lib/platform-guards";
import { listPrivateDocuments } from "@/lib/server/private-document-repository";

const COPY = {
  ru: {
    eyebrow: "Admissions · Документы",
    title: "Приватные документы",
    description:
      "Очередь показывает последние версии из PostgreSQL. Загрузка и повторная отправка доступны только в Student 360.",
    empty: "Документов пока нет.",
    student: "Студент",
    document: "Последняя версия",
    caseStatus: "Статус кейса",
    version: "Версия",
    size: "Размер",
    updated: "Обновлён",
    open: "Открыть в Student 360",
  },
  ky: {
    eyebrow: "Admissions · Документтер",
    title: "Жеке документтер",
    description:
      "Кезек PostgreSQL базасындагы акыркы версияларды көрсөтөт. Жүктөө жана кайра жөнөтүү Student 360 ичинде гана жеткиликтүү.",
    empty: "Азырынча документ жок.",
    student: "Студент",
    document: "Акыркы версия",
    caseStatus: "Кейстин абалы",
    version: "Версия",
    size: "Өлчөмү",
    updated: "Жаңыртылды",
    open: "Student 360 ичинде ачуу",
  },
  en: {
    eyebrow: "Admissions · Documents",
    title: "Private documents",
    description:
      "This queue shows the latest PostgreSQL versions. Upload and resubmission are available only in Student 360.",
    empty: "No documents yet.",
    student: "Student",
    document: "Latest version",
    caseStatus: "Case status",
    version: "Version",
    size: "Size",
    updated: "Updated",
    open: "Open in Student 360",
  },
} as const;

function formatBytes(byteLength: number, locale: Locale): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(byteLength / 1024)} KiB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(byteLength / (1024 * 1024))} MiB`;
}

function formatTimestamp(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function DocumentsPage() {
  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformDocumentsActor(),
  ]);
  const documents = await listPrivateDocuments({
    actorRole: actor.platformRole,
  });
  const copy = COPY[locale];

  return (
    <div className="space-y-5" data-testid="canonical-private-document-queue">
      <header className="border-b border-border pb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
          {copy.eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
          {copy.title}
        </h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-5 text-fg-3">
          {copy.description}
        </p>
      </header>

      {documents.length === 0 ? (
        <Card className="shadow-none">
          <p className="text-[13px] text-fg-3">{copy.empty}</p>
        </Card>
      ) : (
        <Card bodyClassName="px-0 py-0" className="overflow-hidden shadow-none">
          <div className="divide-y divide-border md:hidden">
            {documents.map((document) => (
              <article
                key={document.documentId}
                className="space-y-3 p-4"
              >
                <div>
                  <h2 className="text-[13px] font-semibold text-fg">
                    {document.displayName}
                  </h2>
                  <p className="mt-1 break-words text-[12px] text-fg-2">
                    {document.latestVersion.originalFilename}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-[11.5px] text-fg-3">
                  <div>
                    <dt>{copy.version}</dt>
                    <dd className="mt-1 font-medium text-fg-2">
                      {document.latestVersion.versionNumber}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.caseStatus}</dt>
                    <dd className="mt-1 font-medium text-fg-2">{document.caseStatus}</dd>
                  </div>
                  <div>
                    <dt>{copy.size}</dt>
                    <dd className="mt-1 font-medium text-fg-2">
                      {formatBytes(document.latestVersion.byteLength, locale)}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.updated}</dt>
                    <dd className="mt-1 font-medium text-fg-2">
                      {formatTimestamp(document.updatedAt, locale)}
                    </dd>
                  </div>
                </dl>
                <Link
                  href={`/clients/${document.caseId}#documents`}
                  className="inline-flex min-h-10 items-center justify-center rounded-ctl border border-border bg-surface px-3 text-[12px] font-semibold text-fg hover:bg-surface-2"
                >
                  {copy.open}
                </Link>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-left text-[12.5px]">
              <caption className="sr-only">{copy.title}</caption>
              <thead className="border-b border-border bg-surface-2 text-[10.5px] uppercase tracking-[0.04em] text-fg-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">{copy.student}</th>
                  <th className="px-3 py-3 font-semibold">{copy.document}</th>
                  <th className="px-3 py-3 font-semibold">{copy.caseStatus}</th>
                  <th className="px-3 py-3 font-semibold">{copy.updated}</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    <span className="sr-only">{copy.open}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {documents.map((document) => (
                  <tr
                    key={document.documentId}
                    data-testid="canonical-private-document-queue-row"
                    data-document-id={document.documentId}
                  >
                    <td className="px-4 py-3 font-medium text-fg">
                      {document.displayName}
                    </td>
                    <td className="px-3 py-3 text-fg-2">
                      <p className="max-w-[320px] break-words font-medium">
                        {document.latestVersion.originalFilename}
                      </p>
                      <p className="mt-1 text-[11px] text-fg-3">
                        {copy.version} {document.latestVersion.versionNumber} · {formatBytes(document.latestVersion.byteLength, locale)}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-fg-2">{document.caseStatus}</td>
                    <td className="px-3 py-3 text-fg-3">
                      {formatTimestamp(document.updatedAt, locale)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/clients/${document.caseId}#documents`}
                        className="inline-flex min-h-10 items-center justify-center rounded-ctl border border-border bg-surface px-3 text-[12px] font-semibold text-fg hover:bg-surface-2"
                      >
                        {copy.open}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
