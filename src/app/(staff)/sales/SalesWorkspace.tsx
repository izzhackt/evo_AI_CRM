import Link from "next/link";

import {
  CanonicalAuthorityNotice,
  CanonicalKeyBadge,
  CanonicalUuid,
  formatCanonicalTimestamp,
} from "@/components/platform/core/CanonicalRecordsPresentation";
import { EmptyState, PageHeader, btnGhostCls, filterBarCls, inputCls } from "@/components/ui";
import { getT, type Locale } from "@/lib/i18n";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import {
  CANONICAL_SALES_DUE_FILTERS,
  CANONICAL_SALES_STAGES,
  CanonicalCrmRepositoryError,
  listCanonicalSalesLeads,
  parseCanonicalReadCursor,
  type CanonicalReadCursor,
  type CanonicalSalesDueFilter,
  type CanonicalSalesLeadQueuePage,
  type CanonicalSalesLeadQueueRow,
  type CanonicalSalesStage,
} from "@/lib/server/canonical-crm-repository";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  due?: string | string[];
  q?: string | string[];
  stage?: string | string[];
}>;

type NormalizedParams = Readonly<{
  cursor: CanonicalReadCursor | null;
  due: CanonicalSalesDueFilter;
  listInvalid: boolean;
  query?: string;
  stage?: CanonicalSalesStage;
}>;

const COPY = {
  ru: {
    title: "Лиды EVO",
    description:
      "Рабочая очередь Sales читает лиды напрямую из единой локальной PostgreSQL V2 базы EVO.",
    search: "Поиск по имени, email, телефону, Lead UUID или Person UUID",
    stage: "Этап",
    due: "Срок следующего действия",
    allStages: "Все этапы",
    allDue: "Любой срок",
    scheduled: "Есть дедлайн",
    unscheduled: "Без дедлайна",
    dueToday: "На сегодня",
    overdueFilter: "Просрочено",
    queueTitle: "Каноническая очередь Sales",
    queueDescription:
      "Показан один активный V2 путь: lead, этап, owner role и next action из canonical PostgreSQL.",
    found: "Найдено на странице",
    noAction: "Не назначено",
    noDeadline: "Без срока",
    updated: "Обновлено",
    version: "Версия",
    details: "Открыть",
    first: "К новым",
    next: "Старее",
    empty: "Под выбранные фильтры лидов нет.",
    invalid:
      "Фильтр отклонён. Очередь не читалась, потому что параметры запроса не прошли строгую нормализацию.",
    unavailable:
      "Очередь лидов недоступна из-за ошибки чтения. Это не означает, что лидов нет; попробуйте обновить страницу.",
    stage_new: "Новый",
    stage_qualifying: "В квалификации",
    stage_qualified: "Квалифицирован",
    stage_disqualified: "Дисквалифицирован",
    stage_handoff_ready: "Готов к передаче",
    stage_handed_off: "Передан в Admissions",
    owner: "Owner role",
    nextAction: "Следующее действие",
    leadId: "Lead UUID",
    personId: "Person UUID",
    source: "Источник",
    today: "Сегодня",
    overdue: "Просрочено",
  },
  ky: {
    title: "EVO лиддери",
    description:
      "Sales жумуш кезеги EVOнун бирдиктүү жергиликтүү PostgreSQL V2 базасынан түз окулат.",
    search: "Аты, email, телефон, Lead UUID же Person UUID боюнча издөө",
    stage: "Этап",
    due: "Кийинки аракеттин мөөнөтү",
    allStages: "Бардык этаптар",
    allDue: "Каалаган мөөнөт",
    scheduled: "Мөөнөтү бар",
    unscheduled: "Мөөнөтсүз",
    dueToday: "Бүгүнкүгө",
    overdueFilter: "Мөөнөтү өткөн",
    queueTitle: "Sales'тин каноникалык кезеги",
    queueDescription:
      "Бул жерде бир гана активдүү V2 жол көрсөтүлөт: canonical PostgreSQL'ден lead, этап, owner role жана next action.",
    found: "Барактагы саны",
    noAction: "Дайындалган эмес",
    noDeadline: "Мөөнөтү жок",
    updated: "Жаңыртылды",
    version: "Версия",
    details: "Ачуу",
    first: "Жаңыларына",
    next: "Эскирээк",
    empty: "Тандалган чыпкаларга ылайык лидер жок.",
    invalid:
      "Чыпка четке кагылды. Сурам параметрлери катуу нормалдаштыруудан өтпөгөндүктөн кезек окулган жок.",
    unavailable:
      "Лиддер кезеги окуу катасынан улам жеткиликсиз. Бул лиддер жок дегенди билдирбейт; баракты жаңыртып көрүңүз.",
    stage_new: "Жаңы",
    stage_qualifying: "Квалификацияда",
    stage_qualified: "Квалификациядан өттү",
    stage_disqualified: "Дисквалификацияланды",
    stage_handoff_ready: "Өткөрүүгө даяр",
    stage_handed_off: "Admissions'ке өткөрүлдү",
    owner: "Owner role",
    nextAction: "Кийинки аракет",
    leadId: "Lead UUID",
    personId: "Person UUID",
    source: "Булак",
    today: "Бүгүн",
    overdue: "Мөөнөтү өткөн",
  },
  en: {
    title: "EVO leads",
    description:
      "The Sales work queue reads leads directly from EVO's single local PostgreSQL V2 database.",
    search: "Search by name, email, phone, Lead UUID, or Person UUID",
    stage: "Stage",
    due: "Next-action due state",
    allStages: "All stages",
    allDue: "Any due state",
    scheduled: "Scheduled",
    unscheduled: "Unscheduled",
    dueToday: "Due today",
    overdueFilter: "Overdue",
    queueTitle: "Canonical Sales queue",
    queueDescription:
      "This page shows one active V2 path only: lead, stage, owner role, and next action from canonical PostgreSQL.",
    found: "Found on page",
    noAction: "Not scheduled",
    noDeadline: "No deadline",
    updated: "Updated",
    version: "Version",
    details: "Open",
    first: "Back to newest",
    next: "Older",
    empty: "No leads match the selected filters.",
    invalid:
      "The filter was rejected. The queue was not read because the request parameters failed strict normalization.",
    unavailable:
      "The lead queue is unavailable because the read failed. This does not mean there are no leads; try refreshing the page.",
    stage_new: "New",
    stage_qualifying: "Qualifying",
    stage_qualified: "Qualified",
    stage_disqualified: "Disqualified",
    stage_handoff_ready: "Handoff ready",
    stage_handed_off: "Handed off to Admissions",
    owner: "Owner role",
    nextAction: "Next action",
    leadId: "Lead UUID",
    personId: "Person UUID",
    source: "Source",
    today: "Today",
    overdue: "Overdue",
  },
} as const;

const DUE_LABELS: Record<
  Locale,
  Record<Exclude<CanonicalSalesDueFilter, "all">, string>
> = {
  ru: {
    scheduled: COPY.ru.scheduled,
    unscheduled: COPY.ru.unscheduled,
    due_today: COPY.ru.dueToday,
    overdue: COPY.ru.overdueFilter,
  },
  ky: {
    scheduled: COPY.ky.scheduled,
    unscheduled: COPY.ky.unscheduled,
    due_today: COPY.ky.dueToday,
    overdue: COPY.ky.overdueFilter,
  },
  en: {
    scheduled: COPY.en.scheduled,
    unscheduled: COPY.en.unscheduled,
    due_today: COPY.en.dueToday,
    overdue: COPY.en.overdueFilter,
  },
};

export async function SalesWorkspace({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
    searchParams,
  ]);

  const normalized = normalizeSearchParams(params);
  const actorRole = actor.platformRole === "admin" ? "admin" : "sales";
  const queueRead = normalized.listInvalid
    ? Promise.resolve<{ page: null; unavailable: false }>({
        page: null,
        unavailable: false,
      })
    : readCanonicalSalesQueue(actorRole, normalized);
  const queueResult = await queueRead;

  return (
    <CanonicalSalesPresentation
      locale={locale}
      page={queueResult.page}
      params={normalized}
      listInvalid={normalized.listInvalid}
      listUnavailable={queueResult.unavailable}
    />
  );
}

async function readCanonicalSalesQueue(
  actorRole: "admin" | "sales",
  params: NormalizedParams,
): Promise<Readonly<{ page: CanonicalSalesLeadQueuePage | null; unavailable: boolean }>> {
  try {
    const page = await listCanonicalSalesLeads({
      actorRole,
      cursor: params.cursor ?? undefined,
      due: params.due,
      pageSize: 50,
      query: params.query,
      stage: params.stage,
    });
    return { page, unavailable: false };
  } catch (error) {
    if (error instanceof CanonicalCrmRepositoryError) {
      return { page: null, unavailable: true };
    }
    return { page: null, unavailable: true };
  }
}

function CanonicalSalesPresentation({
  locale,
  page,
  params,
  listInvalid,
  listUnavailable,
}: Readonly<{
  locale: Locale;
  page: CanonicalSalesLeadQueuePage | null;
  params: NormalizedParams;
  listInvalid: boolean;
  listUnavailable: boolean;
}>) {
  const copy = COPY[locale];
  const rows = page?.rows ?? [];

  return (
    <div className="min-w-0" data-testid="platform-sales-page">
      <div className="space-y-5" data-testid="canonical-sales-page">
        <PageHeader title={copy.title} description={copy.description} />
        <CanonicalAuthorityNotice locale={locale} />

        <section className="space-y-4" aria-labelledby="sales-workflow-title">
          <div className="space-y-1">
            <h2 id="sales-workflow-title" className="text-[15px] font-semibold text-fg">
              {copy.queueTitle}
            </h2>
            <p className="max-w-4xl text-[12.5px] leading-5 text-fg-3">
              {copy.queueDescription}
            </p>
          </div>

          <form className={filterBarCls} method="get">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">
              {copy.search}
              <input
                type="search"
                name="q"
                defaultValue={params.query ?? ""}
                className={inputCls}
              />
            </label>

            <label className="flex min-w-[190px] flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">
              {copy.stage}
              <select name="stage" defaultValue={params.stage ?? ""} className={inputCls}>
                <option value="">{copy.allStages}</option>
                {CANONICAL_SALES_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {stageLabel(locale, stage)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[190px] flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">
              {copy.due}
              <select name="due" defaultValue={params.due} className={inputCls}>
                <option value="all">{copy.allDue}</option>
                {CANONICAL_SALES_DUE_FILTERS.filter((due) => due !== "all").map((due) => (
                  <option key={due} value={due}>
                    {DUE_LABELS[locale][due]}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" className={btnGhostCls}>
              {copy.details}
            </button>
          </form>

          {listInvalid ? (
            <div data-testid="canonical-records-unavailable">
              <EmptyState text={copy.invalid} />
            </div>
          ) : listUnavailable ? (
            <div data-testid="canonical-records-unavailable">
              <EmptyState text={copy.unavailable} />
            </div>
          ) : page ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-[12px] text-fg-3">
                <Metric label={copy.found} value={rows.length} />
              </div>

              {rows.length === 0 ? (
                <div data-testid="canonical-sales-empty">
                  <EmptyState text={copy.empty} />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-fg-3">
                        <th className="border-b border-border px-3 py-2">{copy.leadId}</th>
                        <th className="border-b border-border px-3 py-2">{copy.personId}</th>
                        <th className="border-b border-border px-3 py-2">{copy.stage}</th>
                        <th className="border-b border-border px-3 py-2">{copy.owner}</th>
                        <th className="border-b border-border px-3 py-2">{copy.nextAction}</th>
                        <th className="border-b border-border px-3 py-2">{copy.updated}</th>
                        <th className="border-b border-border px-3 py-2">{copy.details}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((lead) => (
                        <SalesRow key={lead.leadId} lead={lead} locale={locale} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {page.hasNext || params.cursor ? (
                <nav className="flex items-center justify-between gap-3" aria-label={copy.queueTitle}>
                  {params.cursor ? (
                    <Link href={salesHref(params, { cursor: null })} className={btnGhostCls}>
                      ← {copy.first}
                    </Link>
                  ) : (
                    <span />
                  )}

                  {page.hasNext && page.nextCursor ? (
                    <Link
                      href={salesHref(params, { cursor: page.nextCursor })}
                      className={btnGhostCls}
                      rel="next"
                    >
                      {copy.next} →
                    </Link>
                  ) : null}
                </nav>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function SalesRow({
  lead,
  locale,
}: Readonly<{
  lead: CanonicalSalesLeadQueueRow;
  locale: Locale;
}>) {
  const copy = COPY[locale];
  const today = bishkekCalendarDate();
  const dueDate = lead.nextActionAt ? bishkekCalendarDate(new Date(lead.nextActionAt)) : null;
  const isOverdue = dueDate !== null && dueDate < today;
  const isDueToday = dueDate === today;

  return (
    <tr
      className="align-top"
      data-testid="canonical-lead-row"
      data-lead-id={lead.leadId}
      data-record-version={lead.version}
    >
      <td className="border-b border-border px-3 py-3 text-[12px] text-fg-2">
        <div className="space-y-2">
          <CanonicalUuid value={lead.leadId} />
          <div className="font-medium text-fg">{lead.displayName}</div>
          <div>{lead.email ?? lead.phone ?? copy.noAction}</div>
          <div>{copy.source}: {lead.source}</div>
        </div>
      </td>
      <td className="border-b border-border px-3 py-3 text-[12px] text-fg-2">
        <CanonicalUuid value={lead.personId} />
      </td>
      <td className="border-b border-border px-3 py-3 text-[12px] text-fg-2">
        <div className="space-y-2">
          <CanonicalKeyBadge value={lead.stage} />
          <div>{stageLabel(locale, lead.stage)}</div>
          {lead.qualificationSummary ? (
            <p className="max-w-[260px] text-[11.5px] leading-4 text-fg-3">
              {lead.qualificationSummary}
            </p>
          ) : null}
        </div>
      </td>
      <td className="border-b border-border px-3 py-3 text-[12px] text-fg-2">
        <CanonicalKeyBadge value={lead.ownerRole} />
      </td>
      <td className="border-b border-border px-3 py-3 text-[12px] text-fg-2">
        <div className="space-y-2">
          <div>{lead.nextAction ?? copy.noAction}</div>
          <div className="text-[11.5px] text-fg-3">
            {lead.nextActionAt ? formatCanonicalTimestamp(lead.nextActionAt, locale) : copy.noDeadline}
          </div>
          {isOverdue ? (
            <span className="inline-flex rounded-full bg-danger-weak px-2 py-1 text-[11px] font-semibold text-danger">
              {copy.overdue}
            </span>
          ) : isDueToday ? (
            <span className="inline-flex rounded-full bg-warn-weak px-2 py-1 text-[11px] font-semibold text-warn">
              {copy.today}
            </span>
          ) : null}
        </div>
      </td>
      <td className="border-b border-border px-3 py-3 text-[12px] text-fg-2">
        <div className="space-y-2">
          <div>{formatCanonicalTimestamp(lead.updatedAt, locale)}</div>
          <div>{copy.version}: <span className="font-mono">{lead.version}</span></div>
        </div>
      </td>
      <td className="border-b border-border px-3 py-3 text-[12px] text-fg-2">
        <Link href={`/sales/${lead.leadId}`} className={btnGhostCls}>
          {copy.details}
        </Link>
      </td>
    </tr>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="flex items-center gap-2">
      <span>{label}</span>
      <strong className="text-fg">{value}</strong>
    </div>
  );
}

function stageLabel(locale: Locale, stage: CanonicalSalesStage) {
  return COPY[locale][`stage_${stage}`];
}

function normalizeSearchParams(params: SearchParams): NormalizedParams {
  try {
    assertOnlySearchKeys(params, ["before_at", "before_id", "due", "q", "stage"]);
    const beforeAt = singleValue(params.before_at);
    const beforeId = singleValue(params.before_id);
    const query = trimmed(singleValue(params.q));
    const stageRaw = trimmed(singleValue(params.stage));
    const dueRaw = trimmed(singleValue(params.due)) ?? "all";
    const stage = stageRaw ? normalizeStage(stageRaw) : undefined;
    const due = normalizeDue(dueRaw);
    const cursor =
      beforeAt === undefined && beforeId === undefined
        ? null
        : parseCanonicalReadCursor(beforeAt, beforeId);

    if (query && query.length > 120) throw new CanonicalCrmRepositoryError("invalid_input");

    return {
      cursor,
      due,
      listInvalid: false,
      query,
      stage,
    };
  } catch {
    return {
      cursor: null,
      due: "all",
      listInvalid: true,
    };
  }
}

function assertOnlySearchKeys(
  params: SearchParams,
  allowedKeys: readonly string[],
) {
  for (const key of Object.keys(params)) {
    if (!allowedKeys.includes(key)) {
      throw new CanonicalCrmRepositoryError("invalid_input");
    }
  }
}

function singleValue(value: string | string[] | undefined) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new CanonicalCrmRepositoryError("invalid_input");
    return value[0];
  }
  return value;
}

function trimmed(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeStage(value: string): CanonicalSalesStage {
  if ((CANONICAL_SALES_STAGES as readonly string[]).includes(value)) {
    return value as CanonicalSalesStage;
  }
  throw new CanonicalCrmRepositoryError("invalid_input");
}

function normalizeDue(value: string): CanonicalSalesDueFilter {
  if ((CANONICAL_SALES_DUE_FILTERS as readonly string[]).includes(value)) {
    return value as CanonicalSalesDueFilter;
  }
  throw new CanonicalCrmRepositoryError("invalid_input");
}

function salesHref(
  params: NormalizedParams,
  updates: Readonly<{ cursor: CanonicalReadCursor | null }>,
) {
  const query = new URLSearchParams();
  if (params.query) query.set("q", params.query);
  if (params.stage) query.set("stage", params.stage);
  if (params.due !== "all") query.set("due", params.due);
  if (updates.cursor) {
    query.set("before_at", updates.cursor.updatedAt);
    query.set("before_id", updates.cursor.id);
  }
  const suffix = query.toString();
  return suffix.length > 0 ? `/sales?${suffix}` : "/sales";
}

function bishkekCalendarDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
