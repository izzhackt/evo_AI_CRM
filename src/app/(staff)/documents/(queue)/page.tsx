import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import { getT } from "@/lib/i18n";
import { requirePlatformDocumentsActor } from "@/lib/platform-guards";
import { listPlatformDocumentQueue } from "@/lib/platform-private-documents";
import { buildRouteMetadata } from "@/lib/route-metadata";

const COPY = {
  ru: {
    title: "Приватные документы",
    description:
      "Единая очередь требований и неизменяемых версий из PostgreSQL. Файлы доступны только через краткоживущую приватную ссылку Supabase Storage.",
    empty: "Требований к документам пока нет.",
    student: "Студент",
    requirement: "Требование",
    current: "Текущая версия",
    status: "Статус",
    updated: "Обновлено",
    version: "Версия",
    noFile: "Файл ещё не загружен",
    download: "Скачать",
    open: "Открыть в Student 360",
    more: "Показаны первые 50 записей. Уточните очередь в Student 360.",
  },
  ky: {
    title: "Жеке документтер",
    description:
      "PostgreSQL базасындагы талаптардын жана өзгөртүлбөс версиялардын бирдиктүү кезеги. Файлдар кыска мөөнөттүү жеке Supabase Storage шилтемеси аркылуу гана ачылат.",
    empty: "Азырынча документ талаптары жок.",
    student: "Студент",
    requirement: "Талап",
    current: "Учурдагы версия",
    status: "Абалы",
    updated: "Жаңыртылды",
    version: "Версия",
    noFile: "Файл жүктөлө элек",
    download: "Жүктөп алуу",
    open: "Student 360 ичинде ачуу",
    more: "Алгачкы 50 жазуу көрсөтүлдү. Кезекти Student 360 ичинде тактаңыз.",
  },
  en: {
    title: "Private documents",
    description:
      "One PostgreSQL queue for requirements and immutable versions. Files are served only through a short-lived private Supabase Storage link.",
    empty: "No document requirements yet.",
    student: "Student",
    requirement: "Requirement",
    current: "Current version",
    status: "Status",
    updated: "Updated",
    version: "Version",
    noFile: "No file uploaded",
    download: "Download",
    open: "Open in Student 360",
    more: "Showing the first 50 records. Open Student 360 to narrow the queue.",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: COPY.ru.title,
    ky: COPY.ky.title,
    en: COPY.en.title,
  });
}

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
  const queue = await listPlatformDocumentQueue(actor);
  const copy = COPY[locale];

  return (
    <div className="space-y-5" data-testid="platform-private-document-queue">
      <header className="border-b border-border pb-5">
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
          {copy.title}
        </h1>
        <p className="mt-2 max-w-[56ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
      </header>

      {queue.rows.length === 0 ? (
        <Card className="shadow-none">
          <p className="text-sm text-fg-3">{copy.empty}</p>
        </Card>
      ) : (
        <Card bodyClassName="px-0 py-0" className="overflow-hidden shadow-none">
          <div className="divide-y divide-border md:hidden">
            {queue.rows.map((row) => (
              <article key={row.documentSlotId} className="space-y-3 p-4">
                <div>
                  <h2 className="text-sm font-semibold text-fg">
                    {row.studentDisplayName}
                  </h2>
                  <p className="mt-1 text-xs text-fg-2">{row.requirementLabel}</p>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs text-fg-3">
                  <div>
                    <dt>{copy.status}</dt>
                    <dd className="mt-1 font-medium text-fg-2">{row.status}</dd>
                  </div>
                  <div>
                    <dt>{copy.updated}</dt>
                    <dd className="mt-1 font-medium text-fg-2">
                      {formatTimestamp(row.updatedAt, locale)}
                    </dd>
                  </div>
                </dl>
                {row.currentVersionId && row.currentOriginalFilename ? (
                  <p className="break-words text-xs text-fg-2">
                    {copy.version} {row.currentVersionNumber}: {row.currentOriginalFilename}
                    {row.currentByteSize !== null
                      ? ` · ${formatBytes(row.currentByteSize, locale)}`
                      : ""}
                  </p>
                ) : (
                  <p className="text-xs text-fg-3">{copy.noFile}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {row.downloadReady && row.currentVersionId ? (
                    <a
                      href={`/api/v2/document-versions/${row.currentVersionId}/download`}
                      className="inline-flex min-h-10 items-center justify-center rounded-ctl border border-border bg-surface px-3 text-xs font-semibold text-fg hover:bg-surface-2"
                    >
                      {copy.download}
                    </a>
                  ) : null}
                  <Link
                    href={`/clients/${row.studentCaseId}#case-documents`}
                    className="inline-flex min-h-10 items-center justify-center rounded-ctl border border-border bg-surface px-3 text-xs font-semibold text-fg hover:bg-surface-2"
                  >
                    {copy.open}
                  </Link>
                </div>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="border-b border-border bg-surface-2 text-xs text-fg-3">
                <tr>
                  <th className="px-4 py-3 font-medium">{copy.student}</th>
                  <th className="px-3 py-3 font-medium">{copy.requirement}</th>
                  <th className="px-3 py-3 font-medium">{copy.current}</th>
                  <th className="px-3 py-3 font-medium">{copy.status}</th>
                  <th className="px-3 py-3 font-medium">{copy.updated}</th>
                  <th className="px-4 py-3" aria-label={copy.open} />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {queue.rows.map((row) => (
                  <tr
                    key={row.documentSlotId}
                    data-testid="platform-private-document-queue-row"
                    data-document-slot-id={row.documentSlotId}
                  >
                    <td className="px-4 py-3 font-medium text-fg">
                      {row.studentDisplayName}
                    </td>
                    <td className="px-3 py-3 text-fg-2">{row.requirementLabel}</td>
                    <td className="px-3 py-3 text-fg-2">
                      {row.currentVersionId && row.currentOriginalFilename ? (
                        <div>
                          <p className="max-w-[320px] break-words font-medium">
                            {row.currentOriginalFilename}
                          </p>
                          <p className="mt-1 text-xs text-fg-3">
                            {copy.version} {row.currentVersionNumber}
                            {row.currentByteSize !== null
                              ? ` · ${formatBytes(row.currentByteSize, locale)}`
                              : ""}
                          </p>
                        </div>
                      ) : copy.noFile}
                    </td>
                    <td className="px-3 py-3 text-fg-2">{row.status}</td>
                    <td className="px-3 py-3 text-fg-3">
                      {formatTimestamp(row.updatedAt, locale)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {row.downloadReady && row.currentVersionId ? (
                          <a
                            href={`/api/v2/document-versions/${row.currentVersionId}/download`}
                            className="inline-flex min-h-10 items-center justify-center rounded-ctl border border-border bg-surface px-3 text-xs font-semibold text-fg hover:bg-surface-2"
                          >
                            {copy.download}
                          </a>
                        ) : null}
                        <Link
                          href={`/clients/${row.studentCaseId}#case-documents`}
                          className="inline-flex min-h-10 items-center justify-center rounded-ctl border border-border bg-surface px-3 text-xs font-semibold text-fg hover:bg-surface-2"
                        >
                          {copy.open}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {queue.hasMore ? <p className="text-xs text-fg-3">{copy.more}</p> : null}
    </div>
  );
}
