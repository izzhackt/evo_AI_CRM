import Link from "next/link";

import {
  CanonicalKeyBadge,
  CanonicalUuid,
  formatCanonicalTimestamp,
} from "@/components/platform/core/CanonicalRecordsPresentation";
import { EmptyState, PageHeader, btnGhostCls, filterBarCls, inputCls } from "@/components/ui";
import { getT, type Locale } from "@/lib/i18n";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import {
  PLATFORM_SALES_DUE_FILTERS,
  PLATFORM_SALES_STAGES,
  PlatformSalesRepositoryError,
  listPlatformSalesLeads,
  parsePlatformSalesCursor,
  type PlatformSalesCursor,
  type PlatformSalesDueFilter,
  type PlatformSalesLeadPage,
  type PlatformSalesLeadRow,
  type PlatformSalesStage,
} from "@/lib/platform-sales";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  due?: string | string[];
  q?: string | string[];
  stage?: string | string[];
}>;

type NormalizedParams = Readonly<{
  cursor: PlatformSalesCursor | null;
  due: PlatformSalesDueFilter;
  listInvalid: boolean;
  query?: string;
  stage?: PlatformSalesStage;
}>;

const COPY = {
  ru: {
    title: "Лиды EVO",
    description:
      "Рабочая очередь Sales читает канонические лиды из Supabase через права текущего сотрудника.",
    search: "Поиск по имени, email, телефону, Lead UUID или Client UUID",
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
      "Единственный активный путь: Supabase Platform, RLS, текущий ответственный и следующий шаг.",
    found: "Найдено на странице",
    noAction: "Не назначено",
    noDeadline: "Без срока",
    updated: "Обновлено",
    workflowVersion: "Версия Sales workflow",
    details: "Открыть",
    first: "К новым",
    next: "Старее",
    empty: "Под выбранные фильтры лидов нет.",
    invalid:
      "Фильтр отклонён. Очередь не читалась, потому что параметры запроса не прошли строгую нормализацию.",
    unavailable:
      "Очередь лидов недоступна из-за ошибки чтения. Это не означает, что лидов нет; попробуйте обновить страницу.",
    stage_new: "Новый",
    stage_contacting: "Устанавливаем контакт",
    stage_qualified: "Квалифицирован",
    stage_meeting_scheduled: "Встреча назначена",
    stage_meeting_completed: "Встреча проведена",
    stage_potential: "Потенциальный клиент",
    owner: "Текущий ответственный",
    noOwner: "Не назначен",
    nextAction: "Следующее действие",
    leadId: "Lead UUID",
    clientId: "Client UUID",
    source: "Источник",
    today: "Сегодня",
    overdue: "Просрочено",
  },
  ky: {
    title: "EVO лиддери",
    description:
      "Sales жумуш кезеги каноникалык лиддерди кызматкердин укуктары менен Supabase'тен окуйт.",
    search: "Аты, email, телефон, Lead UUID же Client UUID боюнча издөө",
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
      "Бир гана активдүү жол: Supabase Platform, RLS, учурдагы жооптуу жана кийинки аракет.",
    found: "Барактагы саны",
    noAction: "Дайындалган эмес",
    noDeadline: "Мөөнөтү жок",
    updated: "Жаңыртылды",
    workflowVersion: "Sales workflow версиясы",
    details: "Ачуу",
    first: "Жаңыларына",
    next: "Эскирээк",
    empty: "Тандалган чыпкаларга ылайык лидер жок.",
    invalid:
      "Чыпка четке кагылды. Сурам параметрлери катуу нормалдаштыруудан өтпөгөндүктөн кезек окулган жок.",
    unavailable:
      "Лиддер кезеги окуу катасынан улам жеткиликсиз. Бул лиддер жок дегенди билдирбейт; баракты жаңыртып көрүңүз.",
    stage_new: "Жаңы",
    stage_contacting: "Байланыш түзүлүүдө",
    stage_qualified: "Квалификациядан өттү",
    stage_meeting_scheduled: "Жолугушуу дайындалды",
    stage_meeting_completed: "Жолугушуу өттү",
    stage_potential: "Потенциалдуу кардар",
    owner: "Учурдагы жооптуу",
    noOwner: "Дайындалган эмес",
    nextAction: "Кийинки аракет",
    leadId: "Lead UUID",
    clientId: "Client UUID",
    source: "Булак",
    today: "Бүгүн",
    overdue: "Мөөнөтү өткөн",
  },
  en: {
    title: "EVO leads",
    description:
      "The Sales work queue reads canonical leads from Supabase under the current staff member's permissions.",
    search: "Search by name, email, phone, Lead UUID, or Client UUID",
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
      "One active path only: Supabase Platform, RLS, current owner, and next action.",
    found: "Found on page",
    noAction: "Not scheduled",
    noDeadline: "No deadline",
    updated: "Updated",
    workflowVersion: "Sales workflow version",
    details: "Open",
    first: "Back to newest",
    next: "Older",
    empty: "No leads match the selected filters.",
    invalid:
      "The filter was rejected. The queue was not read because the request parameters failed strict normalization.",
    unavailable:
      "The lead queue is unavailable because the read failed. This does not mean there are no leads; try refreshing the page.",
    stage_new: "New",
    stage_contacting: "Contacting",
    stage_qualified: "Qualified",
    stage_meeting_scheduled: "Meeting scheduled",
    stage_meeting_completed: "Meeting completed",
    stage_potential: "Potential",
    owner: "Current owner",
    noOwner: "Unassigned",
    nextAction: "Next action",
    leadId: "Lead UUID",
    clientId: "Client UUID",
    source: "Source",
    today: "Today",
    overdue: "Overdue",
  },
} as const;

const DUE_LABELS: Record<
  Locale,
  Record<Exclude<PlatformSalesDueFilter, "all">, string>
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
  const queueRead = normalized.listInvalid
    ? Promise.resolve<{ page: null; unavailable: false }>({
        page: null,
        unavailable: false,
      })
    : readPlatformSalesQueue(actor, normalized);
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

async function readPlatformSalesQueue(
  actor: ActivePlatformActor,
  params: NormalizedParams,
): Promise<Readonly<{ page: PlatformSalesLeadPage | null; unavailable: boolean }>> {
  try {
    const page = await listPlatformSalesLeads(actor, {
      cursor: params.cursor ?? undefined,
      dueFilter: params.due,
      pageSize: 15,
      query: params.query,
      stageFilter: params.stage,
    });
    return { page, unavailable: false };
  } catch (error) {
    if (error instanceof PlatformSalesRepositoryError) {
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
  page: PlatformSalesLeadPage | null;
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

        <section className="space-y-4" aria-labelledby="sales-workflow-title">
          <div className="space-y-1">
            <h2 id="sales-workflow-title" className="text-md font-semibold text-fg">
              {copy.queueTitle}
            </h2>
            <p className="max-w-[56ch] text-sm leading-5 text-fg-3">
              {copy.queueDescription}
            </p>
          </div>

          <form className={filterBarCls} method="get">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-semibold text-fg-3">
              {copy.search}
              <input
                type="search"
                name="q"
                defaultValue={params.query ?? ""}
                className={inputCls}
              />
            </label>

            <label className="flex min-w-[190px] flex-col gap-1 text-xs font-semibold text-fg-3">
              {copy.stage}
              <select name="stage" defaultValue={params.stage ?? ""} className={inputCls}>
                <option value="">{copy.allStages}</option>
                {PLATFORM_SALES_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {stageLabel(locale, stage)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[190px] flex-col gap-1 text-xs font-semibold text-fg-3">
              {copy.due}
              <select name="due" defaultValue={params.due} className={inputCls}>
                <option value="all">{copy.allDue}</option>
                {PLATFORM_SALES_DUE_FILTERS.filter((due) => due !== "all").map((due) => (
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
              <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-xs text-fg-3">
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
                      <tr className="text-left text-xs uppercase tracking-[0.05em] text-fg-3">
                        <th className="border-b border-border px-3 py-2">{copy.leadId}</th>
                        <th className="border-b border-border px-3 py-2">{copy.clientId}</th>
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
  lead: PlatformSalesLeadRow;
  locale: Locale;
}>) {
  const copy = COPY[locale];
  const today = bishkekCalendarDate();
  const dueDate = lead.nextActionDueDate;
  const isOverdue = dueDate !== null && dueDate < today;
  const isDueToday = dueDate === today;

  return (
    <tr
      className="align-top"
      data-testid="canonical-lead-row"
      data-lead-id={lead.leadId}
      data-workflow-version={lead.workflowVersion}
    >
      <td className="border-b border-border px-3 py-3 text-xs text-fg-2">
        <div className="space-y-2">
          <CanonicalUuid value={lead.leadId} />
          <div className="font-medium text-fg">
            {lead.clientDisplayName ?? lead.clientEmail ?? lead.clientPhone ?? lead.leadId}
          </div>
          <div>{lead.clientEmail ?? lead.clientPhone ?? copy.noAction}</div>
          <div>{copy.source}: {lead.sourceKey}</div>
        </div>
      </td>
      <td className="border-b border-border px-3 py-3 text-xs text-fg-2">
        {lead.clientId ? <CanonicalUuid value={lead.clientId} /> : "—"}
      </td>
      <td className="border-b border-border px-3 py-3 text-xs text-fg-2">
        <div className="space-y-2">
          <CanonicalKeyBadge value={lead.stageKey} />
          <div>{stageLabel(locale, lead.stageKey)}</div>
        </div>
      </td>
      <td className="border-b border-border px-3 py-3 text-xs text-fg-2">
        <div className="space-y-2">
          <div className="font-medium text-fg">
            {lead.currentOwnerDisplayName ?? copy.noOwner}
          </div>
          {lead.currentOwnerMembershipId ? (
            <CanonicalUuid value={lead.currentOwnerMembershipId} />
          ) : null}
        </div>
      </td>
      <td className="border-b border-border px-3 py-3 text-xs text-fg-2">
        <div className="space-y-2">
          <div>{lead.nextActionText ?? copy.noAction}</div>
          <div className="text-xs text-fg-3">
            {dueDate ? formatCalendarDate(dueDate, locale) : copy.noDeadline}
          </div>
          {isOverdue ? (
            <span className="inline-flex rounded-full bg-danger-weak px-2 py-1 text-xs font-semibold text-danger">
              {copy.overdue}
            </span>
          ) : isDueToday ? (
            <span className="inline-flex rounded-full bg-warn-weak px-2 py-1 text-xs font-semibold text-warn">
              {copy.today}
            </span>
          ) : null}
        </div>
      </td>
      <td className="border-b border-border px-3 py-3 text-xs text-fg-2">
        <div className="space-y-2">
          <div>{formatCanonicalTimestamp(lead.updatedAt, locale)}</div>
          <div>{copy.workflowVersion}: <span className="font-mono">{lead.workflowVersion}</span></div>
        </div>
      </td>
      <td className="border-b border-border px-3 py-3 text-xs text-fg-2">
        <Link href={`/v3/profile?id=${lead.leadId}`} className={btnGhostCls}>
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

function stageLabel(locale: Locale, stage: PlatformSalesStage) {
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
        : parsePlatformSalesCursor(beforeAt, beforeId);

    if ((beforeAt !== undefined || beforeId !== undefined) && cursor === null) {
      throw new Error("invalid_sales_filter");
    }
    if (query && query.length > 200) throw new Error("invalid_sales_filter");

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
      throw new Error("invalid_sales_filter");
    }
  }
}

function singleValue(value: string | string[] | undefined) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error("invalid_sales_filter");
    return value[0];
  }
  return value;
}

function trimmed(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeStage(value: string): PlatformSalesStage {
  if ((PLATFORM_SALES_STAGES as readonly string[]).includes(value)) {
    return value as PlatformSalesStage;
  }
  throw new Error("invalid_sales_filter");
}

function normalizeDue(value: string): PlatformSalesDueFilter {
  if ((PLATFORM_SALES_DUE_FILTERS as readonly string[]).includes(value)) {
    return value as PlatformSalesDueFilter;
  }
  throw new Error("invalid_sales_filter");
}

function salesHref(
  params: NormalizedParams,
  updates: Readonly<{ cursor: PlatformSalesCursor | null }>,
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

function formatCalendarDate(value: string, locale: Locale): string {
  const localeTag = locale === "ru" ? "ru-RU" : locale === "ky" ? "ky-KG" : "en-US";
  return new Intl.DateTimeFormat(localeTag, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function bishkekCalendarDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
