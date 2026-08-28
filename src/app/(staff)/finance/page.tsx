import Link from "next/link";

import { Card, btnGhostCls, cn } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { requirePlatformCapability } from "@/lib/platform-guards";
import {
  CanonicalCrmRepositoryError,
  listCanonicalFinanceStops,
  parseCanonicalReadCursor,
  type CanonicalReadCursor,
} from "@/lib/server/canonical-crm-repository";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
}>;

const COPY = {
  ru: {
    eyebrow: "Admissions · PostgreSQL",
    title: "Финансовые стопы",
    description: "Минимальный контроль кейса, а не платёжный реестр. Изменения выполняются в Student 360.",
    empty: "Финансовых стоп-состояний пока нет.",
    stopped: "Стоп активен",
    released: "Стоп снят",
    changedBy: "Изменила роль",
    open: "Открыть Student 360",
    first: "К началу",
    next: "Следующие состояния",
  },
  ky: {
    eyebrow: "Admissions · PostgreSQL",
    title: "Каржылык стоптор",
    description: "Бул төлөм реестри эмес, кейстин минималдуу көзөмөлү. Өзгөртүүлөр Student 360 ичинде жасалат.",
    empty: "Азырынча каржылык стоп абалдары жок.",
    stopped: "Стоп активдүү",
    released: "Стоп алынды",
    changedBy: "Өзгөрткөн роль",
    open: "Student 360 ачуу",
    first: "Башына",
    next: "Кийинки абалдар",
  },
  en: {
    eyebrow: "Admissions · PostgreSQL",
    title: "Finance stops",
    description: "Minimal case control, not a payment ledger. All changes are made inside Student 360.",
    empty: "No finance-stop states yet.",
    stopped: "Stop active",
    released: "Stop released",
    changedBy: "Changed by role",
    open: "Open Student 360",
    first: "First page",
    next: "Next states",
  },
} as const;

export default async function FinancePage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformCapability("admissions.read", "/finance"),
    searchParams,
  ]);
  const cursor = queueCursor(params);
  const page = await listCanonicalFinanceStops({
    actorRole: actor.platformRole,
    cursor: cursor ?? undefined,
    pageSize: 50,
  });
  const copy = COPY[locale];

  return (
    <div className="space-y-5" data-testid="canonical-finance-stop-queue">
      <header className="border-b border-border pb-5">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-accent">{copy.eyebrow}</p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-fg">{copy.title}</h1>
        <p className="mt-2 max-w-2xl text-[12.5px] leading-5 text-fg-3">{copy.description}</p>
      </header>

      {page.rows.length === 0 ? (
        <p className="border-y border-border py-8 text-[13px] text-fg-3">{copy.empty}</p>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {page.rows.map((financeStop) => (
              <li key={financeStop.financeStopId} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[13.5px] font-semibold text-fg">{financeStop.displayName}</h2>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", financeStop.isStopped ? "bg-danger-weak text-danger" : "bg-ok-weak text-ok")}>
                        {financeStop.isStopped ? copy.stopped : copy.released}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-5 text-fg-2">{financeStop.reason}</p>
                    <p className="mt-2 text-[11.5px] text-fg-3">{copy.changedBy}: {financeStop.changedByRole}</p>
                  </div>
                  <Link href={`/clients/${financeStop.studentCaseId}#finance`} className="shrink-0 text-[12px] font-semibold text-accent hover:underline">
                    {copy.open}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <nav className="flex items-center justify-between gap-3" aria-label={copy.title}>
        {cursor ? <Link href="/finance" className={btnGhostCls}>← {copy.first}</Link> : <span />}
        {page.hasNext && page.nextCursor ? <Link href={queueHref("/finance", page.nextCursor)} className={btnGhostCls} rel="next">{copy.next} →</Link> : null}
      </nav>
    </div>
  );
}

function queueCursor(params: SearchParams): CanonicalReadCursor | null {
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
