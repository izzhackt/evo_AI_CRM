import type { Metadata } from "next";
import Link from "next/link";

import { Badge, btnGhostCls } from "@/components/ui";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import {
  listPlatformApplications,
  parsePlatformAdmissionsCursor,
  type PlatformAdmissionsCursor,
} from "@/lib/platform-admissions";
import { requirePlatformCapability } from "@/lib/platform-guards";
import { buildRouteMetadata } from "@/lib/route-metadata";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
}>;

const COPY = {
  ru: {
    title: "Заявки в университеты",
    description:
      "Единая очередь Supabase. Детали и изменения доступны в Student 360.",
    empty: "Заявок пока нет.",
    open: "Открыть Student 360",
    curator: "Admissions",
    route: "Маршрут",
    workload: "Открыто",
    first: "К началу",
    next: "Следующие заявки",
    invalid:
      "Параметры очереди отклонены. Данные не читались.",
  },
  ky: {
    title: "Университет арыздары",
    description:
      "Бирдиктүү Supabase кезеги. Деталдар жана өзгөртүүлөр Student 360 ичинде жеткиликтүү.",
    empty: "Азырынча арыз жок.",
    open: "Student 360 ачуу",
    curator: "Admissions",
    route: "Маршрут",
    workload: "Ачык",
    first: "Башына",
    next: "Кийинки арыздар",
    invalid:
      "Кезек параметрлери четке кагылды. Маалымат окулган жок.",
  },
  en: {
    title: "University applications",
    description:
      "One Supabase queue. Details and changes are available in Student 360.",
    empty: "No applications yet.",
    open: "Open Student 360",
    curator: "Admissions",
    route: "Route",
    workload: "Open",
    first: "First page",
    next: "Next applications",
    invalid:
      "Queue parameters were rejected. No data was read.",
  },
} as const;

const STATUS_LABELS: Record<string, Record<Locale, string>> = {
  preparation: { ru: "Подготовка", ky: "Даярдоо", en: "Preparation" },
  ready: { ru: "Готова", ky: "Даяр", en: "Ready" },
  submitted: { ru: "Подана", ky: "Тапшырылды", en: "Submitted" },
  under_review: { ru: "На рассмотрении", ky: "Каралууда", en: "Under review" },
  offer: { ru: "Оффер", ky: "Оффер", en: "Offer" },
  rejected: { ru: "Отказ", ky: "Баш тартылды", en: "Rejected" },
  enrolled: { ru: "Зачислен", ky: "Кабыл алынды", en: "Enrolled" },
  withdrawn: { ru: "Отозвана", ky: "Кайтарылды", en: "Withdrawn" },
  closed: { ru: "Закрыта", ky: "Жабык", en: "Closed" },
};

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function parseQueueCursor(params: SearchParams): PlatformAdmissionsCursor | null {
  try {
    return parsePlatformAdmissionsCursor(
      single(params.before_at),
      single(params.before_id),
    );
  } catch {
    return null;
  }
}

function queueHref(cursor: PlatformAdmissionsCursor): string {
  const query = new URLSearchParams({
    before_at: cursor.sortAt,
    before_id: cursor.id,
  });
  return `/applications?${query.toString()}`;
}

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: COPY.ru.title,
    ky: COPY.ky.title,
    en: COPY.en.title,
  });
}

export default async function ApplicationsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformCapability("admissions.read", "/applications"),
    searchParams,
  ]);
  const hasCursorInput = params.before_at !== undefined || params.before_id !== undefined;
  const cursor = parseQueueCursor(params);
  const copy = COPY[locale];

  if (hasCursorInput && cursor === null) {
    return (
      <div className="space-y-5" data-testid="platform-application-queue">
        <QueueHeader copy={copy} />
        <p data-testid="platform-queue-filter-rejected" role="alert" className="border-y border-warn/30 bg-warn-weak py-6 text-sm text-warn">
          {copy.invalid}
        </p>
        <Link href="/applications" className={btnGhostCls}>{copy.first}</Link>
      </div>
    );
  }

  const page = await listPlatformApplications(actor, { cursor, pageSize: 50 });

  return (
    <div className="space-y-5" data-testid="platform-application-queue">
      <QueueHeader copy={copy} withDescription />
      {page.rows.length === 0 ? (
        <p className="border-y border-border py-8 text-sm text-fg-3">{copy.empty}</p>
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {page.rows.map((application) => (
            <li key={application.universityApplicationId} className="py-5" data-application-id={application.universityApplicationId}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-fg">{application.studentDisplayName}</p>
                  <p className="mt-1 text-sm text-fg-2">{application.institutionName} · {application.programName}</p>
                  <p className="mt-2 text-xs text-fg-3">
                    {copy.route}: {[application.targetCountry, application.targetDegree, application.intake].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p className="mt-1 text-xs text-fg-3">
                    {copy.curator}: {application.currentCuratorDisplayName ?? "—"} · {copy.workload}: {application.openTaskCount} / {application.openDocumentCount} / {application.outstandingPaymentObligationCount}
                  </p>
                </div>
                <Badge value={application.status} label={STATUS_LABELS[application.status]?.[locale] ?? application.status} />
              </div>
              <Link
                href={`/v3/profile?case=${application.studentCaseId}&tab=overview#applications`}
                className="inline-flex min-h-11 shrink-0 items-start pt-0.5 text-xs font-semibold text-accent hover:underline"
              >
                {copy.open}
              </Link>
            </li>
          ))}
        </ol>
      )}
      <nav className="flex flex-wrap gap-2" aria-label={copy.title}>
        {cursor ? <Link href="/applications" className={btnGhostCls}>{copy.first}</Link> : null}
        {page.hasNext && page.nextCursor ? (
          <Link href={queueHref(page.nextCursor)} className={btnGhostCls}>{copy.next}</Link>
        ) : null}
      </nav>
    </div>
  );
}

function QueueHeader({
  copy,
  withDescription = false,
}: Readonly<{
  copy: (typeof COPY)[Locale];
  withDescription?: boolean;
}>) {
  return (
    <header className="border-b border-border pb-5">
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-fg">{copy.title}</h1>
      {withDescription ? (
        <p className="mt-2 max-w-[56ch] text-sm leading-5 text-fg-3">{copy.description}</p>
      ) : null}
    </header>
  );
}
