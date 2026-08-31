import type { Metadata } from "next";
import Link from "next/link";

import { Card, btnGhostCls, cn } from "@/components/ui";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { buildRouteMetadata } from "@/lib/route-metadata";
import { requirePlatformCapability } from "@/lib/platform-guards";
import {
  CanonicalCrmRepositoryError,
  listCanonicalUniversityApplications,
  parseCanonicalReadCursor,
  type CanonicalReadCursor,
} from "@/lib/server/canonical-crm-repository";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
}>;

const COPY = {
  ru: {
    title: "Заявки в университеты",
    description: "Очередь только для чтения. Изменения выполняются в Student 360.",
    empty: "Заявок пока нет.",
    open: "Открыть Student 360",
    nextAction: "Следующее действие",
    noNextAction: "Не задано",
    first: "К началу",
    next: "Следующие заявки",
    invalid:
      "Фильтр отклонён. Очередь заявок не читалась, потому что параметры запроса не прошли строгую нормализацию.",
    filterReset: "К очереди заявок",
  },
  ky: {
    title: "Университет арыздары",
    description: "Окуу үчүн гана кезек. Өзгөртүүлөр Student 360 ичинде жасалат.",
    empty: "Азырынча арыздар жок.",
    open: "Student 360 ачуу",
    nextAction: "Кийинки аракет",
    noNextAction: "Көрсөтүлгөн эмес",
    first: "Башына",
    next: "Кийинки арыздар",
    invalid:
      "Чыпка четке кагылды. Сурам параметрлери катуу нормалдаштыруудан өтпөгөндүктөн арыздар кезеги окулган жок.",
    filterReset: "Арыздар кезегине",
  },
  en: {
    title: "University applications",
    description: "Read-only queue. All changes are made inside Student 360.",
    empty: "No applications yet.",
    open: "Open Student 360",
    nextAction: "Next action",
    noNextAction: "Not set",
    first: "First page",
    next: "Next applications",
    invalid:
      "The filter was rejected. The application queue was not read because the request parameters failed strict normalization.",
    filterReset: "Back to applications",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: COPY.ru.title,
    ky: COPY.ky.title,
    en: COPY.en.title,
  });
}

const STATUS_CLASS = {
  draft: "bg-surface-2 text-fg-2",
  submitted: "bg-info-weak text-info",
  accepted: "bg-ok-weak text-ok",
  rejected: "bg-danger-weak text-danger",
  withdrawn: "bg-warn-weak text-warn",
} as const;

export default async function ApplicationsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformCapability("admissions.read", "/applications"),
    searchParams,
  ]);
  const cursor = queueCursor(params);
  const copyForState = COPY[locale];
  if (cursor === "invalid") {
    return (
      <QueueFilterRejected copy={copyForState} testId="canonical-application-queue" />
    );
  }
  const page = await listCanonicalUniversityApplications({
    actorRole: actor.platformRole,
    cursor: cursor ?? undefined,
    pageSize: 50,
  });
  const copy = COPY[locale];

  return (
    <div className="space-y-5" data-testid="canonical-application-queue">
      <QueueHeader copy={copy} withDescription />

      {page.rows.length === 0 ? (
        <p className="border-y border-border py-8 text-sm text-fg-3">{copy.empty}</p>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {page.rows.map((application) => (
              <li key={application.applicationId} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-fg">{application.institutionName}</h2>
                      <span className={cn("rounded-full px-2 py-0.5 text-2xs font-semibold", STATUS_CLASS[application.status])}>
                        {application.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-fg-2">{application.programName} · {application.targetIntake}</p>
                    <p className="mt-2 text-xs text-fg-3">
                      {application.displayName} · {copy.nextAction}: {application.nextAction ?? copy.noNextAction}
                    </p>
                  </div>
                  <Link href={`/clients/${application.studentCaseId}#applications`} className="inline-flex min-h-11 shrink-0 items-start pt-0.5 text-xs font-semibold text-accent hover:underline">
                    {copy.open}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <nav className="flex items-center justify-between gap-3" aria-label={copy.title}>
        {cursor ? <Link href="/applications" className={btnGhostCls}>← {copy.first}</Link> : <span />}
        {page.hasNext && page.nextCursor ? <Link href={queueHref("/applications", page.nextCursor)} className={btnGhostCls} rel="next">{copy.next} →</Link> : null}
      </nav>
    </div>
  );
}

function queueCursor(
  params: SearchParams,
): CanonicalReadCursor | null | "invalid" {
  try {
    return parseQueueCursor(params);
  } catch (error: unknown) {
    if (
      error instanceof CanonicalCrmRepositoryError &&
      error.code === "invalid_input"
    ) {
      return "invalid";
    }
    throw error;
  }
}

function parseQueueCursor(params: SearchParams): CanonicalReadCursor | null {
  if (Object.keys(params).some((key) => key !== "before_at" && key !== "before_id")) {
    throw new CanonicalCrmRepositoryError("invalid_input");
  }
  const beforeAt = singleValue(params.before_at);
  const beforeId = singleValue(params.before_id);
  if ((beforeAt && !beforeId) || (!beforeAt && beforeId)) {
    throw new CanonicalCrmRepositoryError("invalid_input");
  }
  return beforeAt && beforeId ? parseCanonicalReadCursor(beforeAt, beforeId) : null;
}

function singleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) throw new CanonicalCrmRepositoryError("invalid_input");
  return value;
}

function queueHref(path: string, cursor: CanonicalReadCursor): string {
  const query = new URLSearchParams({ before_at: cursor.updatedAt, before_id: cursor.id });
  return `${path}?${query.toString()}`;
}

function QueueFilterRejected({
  copy,
  testId,
}: Readonly<{
  copy: (typeof COPY)[Locale];
  testId: string;
}>) {
  return (
    <div className="space-y-5" data-testid={testId}>
      <QueueHeader copy={copy} />
      <div data-testid="canonical-queue-filter-rejected">
        <p className="border-y border-border py-8 text-sm text-fg-3">{copy.invalid}</p>
      </div>
      <Link href="/applications" className={btnGhostCls}>{copy.filterReset}</Link>
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
        <p className="mt-2 max-w-[60ch] text-sm leading-5 text-fg-3">{copy.description}</p>
      ) : null}
    </header>
  );
}
