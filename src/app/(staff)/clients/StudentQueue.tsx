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
import { requirePlatformClientsActor } from "@/lib/platform-guards";
import {
  CANONICAL_STUDENT_CASE_STATUSES,
  CanonicalCrmRepositoryError,
  listCanonicalStudentCases,
  parseCanonicalReadCursor,
  type CanonicalReadCursor,
  type CanonicalStudentCaseQueueRow,
  type CanonicalStudentCaseStatus,
} from "@/lib/server/canonical-crm-repository";

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
      "Это рабочий список Student Cases для Admissions в V2. Каждая строка — отдельное дело, с которым работает команда.",
    authority: "Источник данных: текущая база EVO V2.",
    search: "Поиск по имени, контакту, Lead UUID или Student Case UUID",
    status: "Статус дела",
    allStatuses: "Все статусы",
    apply: "Применить",
    clear: "Сбросить",
    studentCase: "Student Case",
    person: "Человек",
    lead: "Lead",
    contacts: "Контакты",
    owner: "Роль",
    updated: "Обновлено",
    empty: "В доступном вам списке пока нет Student Cases.",
    first: "К началу",
    next: "Следующие записи",
    found: "На странице",
    active: "Активные",
    paused: "На паузе",
    closed: "Закрытые",
  },
  ky: {
    title: "Student Cases",
    description:
      "Бул V2деги Admissions үчүн Student Cases тизмеси. Ар бир сап команда иштеген өзүнчө иш.",
    authority: "Маалымат булагы: EVO V2нин учурдагы базасы.",
    search: "Аты, байланыш, Lead UUID же Student Case UUID боюнча издөө",
    status: "Иштин абалы",
    allStatuses: "Бардык абалдар",
    apply: "Колдонуу",
    clear: "Тазалоо",
    studentCase: "Student Case",
    person: "Адам",
    lead: "Lead",
    contacts: "Байланыштар",
    owner: "Роль",
    updated: "Жаңыртылды",
    empty: "Жеткиликтүү тизмеде азырынча Student Cases жок.",
    first: "Башына",
    next: "Кийинки жазуулар",
    found: "Бул бетте",
    active: "Активдүү",
    paused: "Токтотулган",
    closed: "Жабык",
  },
  en: {
    title: "Student Cases",
    description:
      "This is the working Student Case list for Admissions in V2. Each row is a case the team works on.",
    authority: "Data source: the current EVO V2 database.",
    search: "Search name, contact, Lead UUID, or Student Case UUID",
    status: "Case status",
    allStatuses: "All statuses",
    apply: "Apply",
    clear: "Clear",
    studentCase: "Student Case",
    person: "Person",
    lead: "Lead",
    contacts: "Contacts",
    owner: "Owner role",
    updated: "Updated",
    empty: "There are no Student Cases in your accessible list yet.",
    first: "Back to first",
    next: "Next records",
    found: "On this page",
    active: "Active",
    paused: "Paused",
    closed: "Closed",
  },
} as const;

export async function StudentQueue({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformClientsActor(),
    searchParams,
  ]);
  const normalized = normalizeSearchParams(params);
  const page = await listCanonicalStudentCases({
    actorRole: actor.platformRole,
    cursor: normalized.cursor ?? undefined,
    status: normalized.status,
    pageSize: 50,
    query: normalized.query,
  });

  return (
    <CanonicalStudentCasesPresentation
      locale={locale}
      rows={page.rows}
      params={normalized}
      hasNext={page.hasNext}
      nextCursor={page.nextCursor}
    />
  );
}

type NormalizedParams = Readonly<{
  cursor: CanonicalReadCursor | null;
  status?: CanonicalStudentCaseStatus;
  query?: string;
}>;

function normalizeSearchParams(params: SearchParams): NormalizedParams {
  assertOnlySearchKeys(params, ["before_at", "before_id", "status", "q"]);
  const beforeAt = singleValue(params.before_at);
  const beforeId = singleValue(params.before_id);
  const status = trimmed(singleValue(params.status));
  if (
    status &&
    !CANONICAL_STUDENT_CASE_STATUSES.includes(status as CanonicalStudentCaseStatus)
  ) {
    throw new CanonicalCrmRepositoryError("invalid_input");
  }
  if ((beforeAt && !beforeId) || (!beforeAt && beforeId)) {
    throw new CanonicalCrmRepositoryError("invalid_input");
  }
  return {
    cursor:
      beforeAt && beforeId
        ? parseCanonicalReadCursor(beforeAt, beforeId)
        : null,
    status: status as CanonicalStudentCaseStatus | undefined,
    query: trimmed(singleValue(params.q)),
  };
}

function assertOnlySearchKeys(
  params: SearchParams,
  allowedKeys: readonly string[],
) {
  if (Object.keys(params).some((key) => !allowedKeys.includes(key))) {
    throw new CanonicalCrmRepositoryError("invalid_input");
  }
}

function singleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) throw new CanonicalCrmRepositoryError("invalid_input");
  return value;
}

function trimmed(value: string | undefined) {
  const result = value?.trim();
  return result ? result : undefined;
}

function CanonicalStudentCasesPresentation({
  locale,
  rows,
  params,
  hasNext,
  nextCursor,
}: Readonly<{
  locale: Locale;
  rows: readonly CanonicalStudentCaseQueueRow[];
  params: NormalizedParams;
  hasNext: boolean;
  nextCursor: CanonicalReadCursor | null;
}>) {
  const copy = COPY[locale];
  const activeCount = rows.filter((studentCase) => studentCase.status === "active").length;
  const pausedCount = rows.filter((studentCase) => studentCase.status === "paused").length;
  const closedCount = rows.filter((studentCase) => studentCase.status === "closed").length;

  return (
    <div className="min-w-0 space-y-5" data-testid="canonical-student-cases-page">
      <PageHeader title={copy.title} description={copy.description} />

      <section className="rounded-card border border-border bg-surface-2 px-5 py-4">
        <p className="text-[12.5px] text-fg-2">{copy.authority}</p>
      </section>

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-[12px] text-fg-3">
        <Metric label={copy.found} value={rows.length} />
        <Metric label={copy.active} value={activeCount} />
        <Metric label={copy.paused} value={pausedCount} />
        <Metric label={copy.closed} value={closedCount} />
      </div>

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
          {CANONICAL_STUDENT_CASE_STATUSES.map((status) => (
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

      <section aria-label={copy.title} data-testid="canonical-student-case-list">
        {rows.length === 0 ? (
          <div className="border-y border-border" data-testid="canonical-student-cases-empty">
            <EmptyState text={copy.empty} />
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto border-y border-border">
            <table className="w-full min-w-[820px] text-left text-[12.5px]">
              <thead className="border-b border-border bg-surface-2 text-[10.5px] uppercase tracking-[0.04em] text-fg-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">{copy.studentCase}</th>
                  <th className="px-4 py-3 font-semibold">{copy.person}</th>
                  <th className="px-4 py-3 font-semibold">{copy.lead}</th>
                  <th className="px-3 py-3 font-semibold">{copy.contacts}</th>
                  <th className="px-3 py-3 font-semibold">{copy.status}</th>
                  <th className="px-3 py-3 font-semibold">{copy.owner}</th>
                  <th className="px-4 py-3 font-semibold">{copy.updated}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((studentCase) => (
                  <tr
                    key={studentCase.studentCaseId}
                    className="transition-colors hover:bg-surface-2"
                    data-testid="canonical-student-case-row"
                    data-student-case-id={studentCase.studentCaseId}
                    data-lead-id={studentCase.leadId}
                  >
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={`/clients/${studentCase.studentCaseId}`}
                        className="font-semibold text-accent hover:underline"
                      >
                        <span className="block">{studentCase.displayName}</span>
                        <span className="mt-1 block">
                          <CanonicalUuid value={studentCase.studentCaseId} />
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <CanonicalUuid value={studentCase.personId} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={`/sales/${studentCase.leadId}`}
                        className="font-medium text-accent hover:underline"
                      >
                        <CanonicalUuid value={studentCase.leadId} />
                      </Link>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="space-y-1">
                        <div>{studentCase.email ?? "—"}</div>
                        <div>{studentCase.phone ?? "—"}</div>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <CanonicalKeyBadge value={studentCase.status} />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <CanonicalKeyBadge value={studentCase.assignedRole} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="font-mono text-[11.5px] text-fg-3">
                        {formatCanonicalTimestamp(studentCase.updatedAt, locale)}
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

function clientsHref(params: NormalizedParams, cursor?: CanonicalReadCursor) {
  const query = new URLSearchParams();
  if (params.query) query.set("q", params.query);
  if (params.status) query.set("status", params.status);
  if (cursor) {
    query.set("before_at", cursor.updatedAt);
    query.set("before_id", cursor.id);
  }
  const serialized = query.toString();
  return serialized ? `/clients?${serialized}` : "/clients";
}
