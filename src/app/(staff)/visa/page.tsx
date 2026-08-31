import type { Metadata } from "next";
import Link from "next/link";

import { Card, btnGhostCls, cn } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { buildRouteMetadata } from "@/lib/route-metadata";
import { requirePlatformCapability } from "@/lib/platform-guards";
import {
  CanonicalCrmRepositoryError,
  listCanonicalVisaMilestones,
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
    title: "Визовые этапы",
    description: "Шесть канонических этапов по каждому переданному кейсу. Изменения выполняются в Student 360.",
    empty: "Визовых этапов пока нет.",
    open: "Открыть Student 360",
    first: "К началу",
    next: "Следующие этапы",
    kinds: {
      document_preparation: "Подготовка документов",
      appointment: "Запись",
      submission: "Подача",
      biometrics: "Биометрия",
      interview: "Интервью",
      decision: "Решение",
    },
  },
  ky: {
    eyebrow: "Admissions · PostgreSQL",
    title: "Виза этаптары",
    description: "Ар бир өткөрүлгөн кейстеги алты каноникалык этап. Өзгөртүүлөр Student 360 ичинде жасалат.",
    empty: "Азырынча виза этаптары жок.",
    open: "Student 360 ачуу",
    first: "Башына",
    next: "Кийинки этаптар",
    kinds: {
      document_preparation: "Документтерди даярдоо",
      appointment: "Жазылуу",
      submission: "Тапшыруу",
      biometrics: "Биометрия",
      interview: "Маек",
      decision: "Чечим",
    },
  },
  en: {
    eyebrow: "Admissions · PostgreSQL",
    title: "Visa milestones",
    description: "Six canonical milestones for every handed-off case. All changes are made inside Student 360.",
    empty: "No visa milestones yet.",
    open: "Open Student 360",
    first: "First page",
    next: "Next milestones",
    kinds: {
      document_preparation: "Document preparation",
      appointment: "Appointment",
      submission: "Submission",
      biometrics: "Biometrics",
      interview: "Interview",
      decision: "Decision",
    },
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
  pending: "bg-surface-2 text-fg-2",
  in_progress: "bg-info-weak text-info",
  completed: "bg-ok-weak text-ok",
  blocked: "bg-danger-weak text-danger",
} as const;

export default async function VisaPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformCapability("admissions.read", "/visa"),
    searchParams,
  ]);
  const cursor = queueCursor(params);
  const page = await listCanonicalVisaMilestones({
    actorRole: actor.platformRole,
    cursor: cursor ?? undefined,
    pageSize: 50,
  });
  const copy = COPY[locale];

  return (
    <div className="space-y-5" data-testid="canonical-visa-queue">
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
            {page.rows.map((milestone) => (
              <li key={milestone.visaMilestoneId} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[13.5px] font-semibold text-fg">{copy.kinds[milestone.milestoneKind]}</h2>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", STATUS_CLASS[milestone.status])}>
                        {milestone.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] text-fg-2">{milestone.displayName}</p>
                    {milestone.nextAction ? <p className="mt-2 text-[11.5px] text-fg-3">{milestone.nextAction}</p> : null}
                  </div>
                  <Link href={`/clients/${milestone.studentCaseId}#visa`} className="shrink-0 text-[12px] font-semibold text-accent hover:underline">
                    {copy.open}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <nav className="flex items-center justify-between gap-3" aria-label={copy.title}>
        {cursor ? <Link href="/visa" className={btnGhostCls}>← {copy.first}</Link> : <span />}
        {page.hasNext && page.nextCursor ? <Link href={queueHref("/visa", page.nextCursor)} className={btnGhostCls} rel="next">{copy.next} →</Link> : null}
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
