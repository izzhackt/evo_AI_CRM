import Link from "next/link";

import { Icon } from "@/components/icons";
import {
  CanonicalKeyBadge,
  CanonicalUuid,
  formatCanonicalTimestamp,
} from "@/components/platform/core/CanonicalRecordsPresentation";
import {
  EmptyState,
  PageHeader,
  btnCls,
  btnGhostCls,
  filterBarCls,
  inputCls,
} from "@/components/ui";
import { getT, type Locale } from "@/lib/i18n";
import {
  listPlatformStudentCases,
  parsePlatformAdmissionsCursor,
  type PlatformAdmissionsCursor,
  type PlatformStudentCasePageItem,
  type PlatformStudentCaseState,
} from "@/lib/platform-admissions";
import { requirePlatformClientsActor } from "@/lib/platform-guards";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  status?: string | string[];
  q?: string | string[];
}>;

const COPY = {
  ru: {
    title: "Student Cases",
    description:
      "Это рабочий список Student Cases для Admissions в V2. Каждая строка читается из активного Supabase read-model и открывает Student 360.",
    authority: "Источник данных: активная очередь Student Cases в Supabase.",
    search: "Поиск по имени, маршруту, стране или Student Case UUID",
    status: "Статус дела",
    allStatuses: "Все статусы",
    apply: "Применить",
    clear: "Сбросить",
    studentCase: "Student Case",
    route: "Маршрут",
    sales: "Sales",
    admissions: "Admissions",
    attention: "Внимание",
    updated: "Обновлено",
    empty: "В доступном вам списке пока нет Student Cases.",
    invalid:
      "Фильтр отклонён. Очередь Student Cases не читалась, потому что параметры запроса не прошли строгую нормализацию.",
    first: "К началу",
    next: "Следующие записи",
    found: "На странице",
    active: "Активные",
    pending: "Ожидают",
    closed: "Закрытые",
    overdueTasks: "Просроченные задачи",
    overduePayments: "Просроченные платежи",
    rejectedDocuments: "Возвраты документов",
  },
  ky: {
    title: "Student Cases",
    description:
      "Бул V2деги Admissions үчүн Student Cases тизмеси. Ар бир сап активдүү Supabase read-model'ден окулуп, Student 360'ты ачат.",
    authority: "Маалымат булагы: Supabase ичиндеги активдүү Student Cases кезеги.",
    search: "Аты, маршрут, өлкө же Student Case UUID боюнча издөө",
    status: "Иштин абалы",
    allStatuses: "Бардык абалдар",
    apply: "Колдонуу",
    clear: "Тазалоо",
    studentCase: "Student Case",
    route: "Маршрут",
    sales: "Sales",
    admissions: "Admissions",
    attention: "Көңүл буруу",
    updated: "Жаңыртылды",
    empty: "Жеткиликтүү тизмеде азырынча Student Cases жок.",
    invalid:
      "Чыпка четке кагылды. Сурам параметрлери катуу нормалдаштыруудан өтпөгөндүктөн Student Cases кезеги окулган жок.",
    first: "Башына",
    next: "Кийинки жазуулар",
    found: "Бул бетте",
    active: "Активдүү",
    pending: "Күтүүдө",
    closed: "Жабык",
    overdueTasks: "Кечиккен тапшырмалар",
    overduePayments: "Кечиккен төлөмдөр",
    rejectedDocuments: "Кайтарылган документтер",
  },
  en: {
    title: "Student Cases",
    description:
      "This is the working Admissions Student Case list for V2. Each row is read from the active Supabase model and opens Student 360.",
    authority: "Data source: the active Supabase Student Case queue.",
    search: "Search name, route, country, or Student Case UUID",
    status: "Case status",
    allStatuses: "All statuses",
    apply: "Apply",
    clear: "Clear",
    studentCase: "Student Case",
    route: "Route",
    sales: "Sales",
    admissions: "Admissions",
    attention: "Attention",
    updated: "Updated",
    empty: "There are no Student Cases in your accessible list yet.",
    invalid:
      "The filter was rejected. The Student Case queue was not read because the request parameters failed strict normalization.",
    first: "Back to first",
    next: "Next records",
    found: "On this page",
    active: "Active",
    pending: "Pending",
    closed: "Closed",
    overdueTasks: "Overdue tasks",
    overduePayments: "Overdue payments",
    rejectedDocuments: "Rejected documents",
  },
} as const;

type NormalizedParams = Readonly<{
  cursor: PlatformAdmissionsCursor | null;
  listInvalid: boolean;
  status?: PlatformStudentCaseState;
  query?: string;
}>;

export async function StudentQueue({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformClientsActor(),
    searchParams,
  ]);
  const normalized = normalizeSearchParams(params);
  const page = normalized.listInvalid
    ? null
    : await listPlatformStudentCases(actor, {
        cursor: normalized.cursor ?? undefined,
        state: normalized.status,
        pageSize: 50,
        query: normalized.query,
      });

  return (
    <PlatformStudentCasesPresentation
      locale={locale}
      rows={page?.rows ?? []}
      params={normalized}
      hasNext={page?.hasNext ?? false}
      nextCursor={page?.nextCursor ?? null}
    />
  );
}

function normalizeSearchParams(params: SearchParams): NormalizedParams {
  try {
    return parseSearchParams(params);
  } catch {
    return { cursor: null, listInvalid: true };
  }
}

function parseSearchParams(params: SearchParams): NormalizedParams {
  assertOnlySearchKeys(params, ["before_at", "before_id", "status", "q"]);
  const beforeAt = singleValue(params.before_at);
  const beforeId = singleValue(params.before_id);
  const status = trimmed(singleValue(params.status));
  if (status && !["pending", "active", "closed"].includes(status)) {
    throw new Error("invalid_input");
  }
  if ((beforeAt && !beforeId) || (!beforeAt && beforeId)) {
    throw new Error("invalid_input");
  }
  return {
    cursor:
      beforeAt && beforeId
        ? parsePlatformAdmissionsCursor(beforeAt, beforeId)
        : null,
    listInvalid: false,
    status: status as PlatformStudentCaseState | undefined,
    query: trimmed(singleValue(params.q)),
  };
}

function assertOnlySearchKeys(
  params: SearchParams,
  allowedKeys: readonly string[],
) {
  if (Object.keys(params).some((key) => !allowedKeys.includes(key))) {
    throw new Error("invalid_input");
  }
}

function singleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) throw new Error("invalid_input");
  return value;
}

function trimmed(value: string | undefined) {
  const result = value?.trim();
  return result ? result : undefined;
}

function itemStudentCaseId(item: PlatformStudentCasePageItem) {
  return item.studentCase.studentCaseId;
}

function itemStudentDisplayName(item: PlatformStudentCasePageItem) {
  return item.studentCase.studentDisplayName;
}

function itemState(item: PlatformStudentCasePageItem) {
  return item.studentCase.state;
}

function itemUpdatedAt(item: PlatformStudentCasePageItem) {
  return item.access === "full"
    ? item.studentCase.updatedAt
    : item.studentCase.handoffAt;
}

function PlatformStudentCasesPresentation({
  locale,
  rows,
  params,
  hasNext,
  nextCursor,
}: Readonly<{
  locale: Locale;
  rows: readonly PlatformStudentCasePageItem[];
  params: NormalizedParams;
  hasNext: boolean;
  nextCursor: PlatformAdmissionsCursor | null;
}>) {
  const copy = COPY[locale];
  const activeCount = rows.filter((item) => itemState(item) === "active").length;
  const pendingCount = rows.filter((item) => itemState(item) === "pending").length;
  const closedCount = rows.filter((item) => itemState(item) === "closed").length;

  return (
    <div className="min-w-0 space-y-5" data-testid="platform-student-cases-page">
      <PageHeader title={copy.title} description={copy.description} />

      <section className="rounded-card border border-border bg-surface-2 px-5 py-4">
        <p className="text-sm text-fg-2">{copy.authority}</p>
      </section>

      {params.listInvalid ? null : (
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-xs text-fg-3">
          <Metric label={copy.found} value={rows.length} />
          <Metric label={copy.active} value={activeCount} />
          <Metric label={copy.pending} value={pendingCount} />
          <Metric label={copy.closed} value={closedCount} />
        </div>
      )}

      <form
        action="/clients"
        method="get"
        className={`${filterBarCls} sm:grid-cols-[minmax(260px,1fr)_minmax(180px,0.45fr)_auto]`}
        aria-label={copy.title}
      >
        <input
          className={inputCls}
          name="q"
          defaultValue={params.query}
          placeholder={copy.search}
          aria-label={copy.search}
        />
        <select
          className={inputCls}
          name="status"
          defaultValue={params.status ?? ""}
          aria-label={copy.status}
        >
          <option value="">{copy.allStatuses}</option>
          {(["pending", "active", "closed"] as const).map((status) => (
            <option key={status} value={status}>
              {copy[status]}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="submit" className={btnCls}>
            <Icon name="search" size={15} /> {copy.apply}
          </button>
          <Link href="/clients" className={btnGhostCls}>
            {copy.clear}
          </Link>
        </div>
      </form>

      <section aria-label={copy.title} data-testid="platform-student-case-list">
        {params.listInvalid ? (
          <div className="border-y border-border" data-testid="platform-queue-filter-rejected">
            <EmptyState text={copy.invalid} />
          </div>
        ) : rows.length === 0 ? (
          <div className="border-y border-border" data-testid="platform-student-cases-empty">
            <EmptyState text={copy.empty} />
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto border-y border-border">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="border-b border-border bg-surface-2 text-2xs uppercase tracking-[0.04em] text-fg-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">{copy.studentCase}</th>
                  <th className="px-4 py-3 font-semibold">{copy.route}</th>
                  <th className="px-3 py-3 font-semibold">{copy.status}</th>
                  <th className="px-3 py-3 font-semibold">{copy.sales}</th>
                  <th className="px-3 py-3 font-semibold">{copy.admissions}</th>
                  <th className="px-3 py-3 font-semibold">{copy.attention}</th>
                  <th className="px-4 py-3 font-semibold">{copy.updated}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((item) => (
                  <tr
                    key={itemStudentCaseId(item)}
                    className="transition-colors hover:bg-surface-2"
                    data-testid="platform-student-case-row"
                    data-student-case-id={itemStudentCaseId(item)}
                  >
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={`/clients/${itemStudentCaseId(item)}`}
                        className="font-semibold text-accent hover:underline"
                      >
                        <span className="block">{itemStudentDisplayName(item)}</span>
                        <span className="mt-1 block">
                          <CanonicalUuid value={itemStudentCaseId(item)} />
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="space-y-1">
                        {item.access === "full" ? (
                          <>
                            <div>{item.studentCase.operationalStage}</div>
                            <div className="text-xs text-fg-3">
                              {[
                                item.studentCase.targetCountry,
                                item.studentCase.targetDegree,
                              ].filter(Boolean).join(" · ") || "—"}
                            </div>
                          </>
                        ) : (
                          <>
                            <div>sales_summary</div>
                            <div className="text-xs text-fg-3">
                              {[
                                item.studentCase.targetCountry,
                                item.studentCase.targetDegree,
                              ].filter(Boolean).join(" · ") || "—"}
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <CanonicalKeyBadge value={itemState(item)} />
                    </td>
                    <td className="px-3 py-3 align-top">
                      {item.access === "full"
                        ? item.studentCase.responsibleSalesDisplayName
                        : "—"}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {item.access === "full"
                        ? item.studentCase.currentCuratorDisplayName ?? "—"
                        : item.studentCase.assignedCuratorDisplayName}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {item.access === "full" ? (
                        <div className="space-y-1 text-xs text-fg-2">
                          <div>{copy.overdueTasks}: {item.studentCase.overdueTaskCount}</div>
                          <div>{copy.overduePayments}: {item.studentCase.overdueObligationCount}</div>
                          <div>{copy.rejectedDocuments}: {item.studentCase.rejectedDocumentCount}</div>
                        </div>
                      ) : (
                        <div className="space-y-1 text-xs text-fg-2">
                          <div>{copy.route}: sales_summary</div>
                          <div>{copy.updated}: {formatCanonicalTimestamp(item.studentCase.handoffAt, locale)}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="font-mono text-xs text-fg-3">
                        {formatCanonicalTimestamp(itemUpdatedAt(item), locale)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <nav className="flex items-center justify-between gap-3" aria-label={copy.title}>
        {params.cursor ? (
          <Link href={clientsHref(params)} className={btnGhostCls}>
            ← {copy.first}
          </Link>
        ) : (
          <span />
        )}
        {hasNext && nextCursor ? (
          <Link href={clientsHref(params, nextCursor)} className={btnGhostCls} rel="next">
            {copy.next} →
          </Link>
        ) : null}
      </nav>
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <span>
      {label}: <strong className="font-mono text-fg">{value}</strong>
    </span>
  );
}

function clientsHref(params: NormalizedParams, cursor?: PlatformAdmissionsCursor) {
  const query = new URLSearchParams();
  if (params.query) query.set("q", params.query);
  if (params.status) query.set("status", params.status);
  if (cursor) {
    query.set("before_at", cursor.sortAt);
    query.set("before_id", cursor.id);
  }
  const serialized = query.toString();
  return serialized ? `/clients?${serialized}` : "/clients";
}
