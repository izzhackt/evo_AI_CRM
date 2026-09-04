import type { Metadata } from "next";
import Link from "next/link";

import { Badge, btnGhostCls } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { listPlatformFinanceControlQueue } from "@/lib/platform-finance-control";
import { requirePlatformCapability } from "@/lib/platform-guards";
import { buildRouteMetadata } from "@/lib/route-metadata";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
}>;

const COPY = {
  ru: {
    title: "Финансовый контроль",
    description:
      "Остатки, просрочки и активные стопы из Supabase. Изменения выполняются в Student 360.",
    empty: "Кейсов с финансовым контролем пока нет.",
    overdue: "Просрочено",
    outstanding: "Не оплачено",
    stops: "Активные стопы",
    blocked: "Блокируется",
    reason: "Причина",
    nextAction: "Следующее действие",
    open: "Открыть Student 360",
    invalid:
      "Параметры очереди отклонены. Данные не читались.",
    reset: "К финансовому контролю",
  },
  ky: {
    title: "Каржылык көзөмөл",
    description:
      "Supabase ичиндеги калдыктар, кечиктирүүлөр жана активдүү стоптор. Өзгөртүүлөр Student 360 ичинде жасалат.",
    empty: "Каржылык көзөмөлү бар кейстер азырынча жок.",
    overdue: "Кечиккен",
    outstanding: "Төлөнө элек",
    stops: "Активдүү стоптор",
    blocked: "Бөгөттөлөт",
    reason: "Себеп",
    nextAction: "Кийинки аракет",
    open: "Student 360 ачуу",
    invalid:
      "Кезек параметрлери четке кагылды. Маалымат окулган жок.",
    reset: "Каржылык көзөмөлгө",
  },
  en: {
    title: "Finance control",
    description:
      "Supabase outstanding balances, overdue obligations and active stops. Changes are made in Student 360.",
    empty: "No cases currently require finance control.",
    overdue: "Overdue",
    outstanding: "Outstanding",
    stops: "Active stops",
    blocked: "Blocked",
    reason: "Reason",
    nextAction: "Next action",
    open: "Open Student 360",
    invalid:
      "Queue parameters were rejected. No data was read.",
    reset: "Back to finance control",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: COPY.ru.title,
    ky: COPY.ky.title,
    en: COPY.en.title,
  });
}

function hasRejectedQuery(params: SearchParams): boolean {
  try {
    return params.before_at !== undefined || params.before_id !== undefined;
  } catch {
    return true;
  }
}

function QueueHeader({
  copy,
  withDescription = false,
}: Readonly<{
  copy: (typeof COPY)[keyof typeof COPY];
  withDescription?: boolean;
}>) {
  return (
    <header className="border-b border-border pb-5">
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-fg">
        {copy.title}
      </h1>
      {withDescription ? (
        <p className="mt-2 max-w-[56ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
      ) : null}
    </header>
  );
}

export default async function FinancePage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformCapability("admissions.read", "/finance"),
    searchParams,
  ]);
  const copy = COPY[locale];

  if (hasRejectedQuery(params)) {
    return (
      <div className="space-y-5" data-testid="platform-finance-control-queue">
        <QueueHeader copy={copy} />
        <p data-testid="platform-queue-filter-rejected" role="alert" className="border-y border-warn/30 bg-warn-weak py-6 text-sm text-warn">{copy.invalid}</p>
        <Link href="/finance" className={btnGhostCls}>{copy.reset}</Link>
      </div>
    );
  }

  const queue = await listPlatformFinanceControlQueue(actor, { limit: 100 });

  return (
    <div className="space-y-5" data-testid="platform-finance-control-queue">
      <QueueHeader copy={copy} withDescription />
      {queue.length === 0 ? (
        <p className="border-y border-border py-8 text-sm text-fg-3">{copy.empty}</p>
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {queue.map((row) => (
            <li key={row.studentCaseId} className="py-5" data-student-case-id={row.studentCaseId}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-sm font-medium text-fg">{row.studentCaseId}</p>
                  {row.stopReason ? (
                    <div className="mt-3 border-l-2 border-danger pl-3 text-sm text-fg-2">
                      <p>{copy.reason}: {row.stopReason}</p>
                      {row.blockedAction ? <p className="mt-1">{copy.blocked}: {row.blockedAction}</p> : null}
                      {row.stopNextAction ? <p className="mt-1">{copy.nextAction}: {row.stopNextAction}</p> : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge value={row.overdueObligationCount > 0 ? "overdue" : "neutral"} label={`${copy.overdue}: ${row.overdueObligationCount}`} />
                  <Badge value={row.outstandingObligationCount > 0 ? "pending" : "paid"} label={`${copy.outstanding}: ${row.outstandingObligationCount}`} />
                  <Badge value={row.activeStopFactorCount > 0 ? "required" : "approved"} label={`${copy.stops}: ${row.activeStopFactorCount}`} />
                </div>
              </div>
              <Link
                href={`/v3/profile?case=${row.studentCaseId}&tab=money`}
                className="inline-flex min-h-11 shrink-0 items-start pt-0.5 text-xs font-semibold text-accent hover:underline"
              >
                {copy.open}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
