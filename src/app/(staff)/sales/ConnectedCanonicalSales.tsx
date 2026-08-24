import Link from "next/link";

import { Icon } from "@/components/icons";
import {
  CanonicalAuthorityNotice,
  CanonicalKeyBadge,
  CanonicalUuid,
  DuplicateStatus,
  canonicalRecordCopy,
  formatCanonicalTimestamp,
  humanizeCanonicalKey,
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
  PLATFORM_CANONICAL_LEAD_LIFECYCLE_STATES,
  PlatformCanonicalRecordsRepositoryError,
  listPlatformCanonicalLeads,
  parsePlatformCanonicalCursor,
  type PlatformCanonicalCursor,
  type PlatformCanonicalLeadLifecycleState,
  type PlatformCanonicalLeadSummary,
} from "@/lib/platform-canonical-records";
import { requirePlatformSalesActor } from "@/lib/platform-guards";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  lifecycle?: string | string[];
  q?: string | string[];
  stage?: string | string[];
}>;

const COPY = {
  ru: {
    title: "Лиды EVO",
    description:
      "Канонический реестр лидов вашей организации: текущий этап и ответственный принадлежат EVO.",
    search: "Поиск по клиенту, контакту или EVO UUID",
    stage: "Этап EVO",
    lifecycle: "Состояние",
    allLifecycle: "Все состояния",
    apply: "Применить",
    clear: "Сбросить",
    lead: "Лид / клиент",
    owner: "Ответственный EVO",
    source: "Источник",
    secondary: "Связанный контекст",
    updated: "Обновлено",
    notAssigned: "Не назначен",
    noClient: "Клиент ещё не связан",
    conversations: "диалогов",
    studentCases: "Student Cases",
    empty:
      "Канонических лидов в доступной вам организации пока нет. Разговоры и исторические записи не подставляются вместо лидов.",
    first: "К началу",
    next: "Следующие лиды",
    found: "На странице",
    duplicates: "С открытыми дублями",
    unowned: "Без ответственного",
  },
  ky: {
    title: "EVO лиддери",
    description:
      "Уюмуңуздун каноникалык лиддер реестри: учурдагы этап жана жооптуу EVOго таандык.",
    search: "Кардар, байланыш же EVO UUID боюнча издөө",
    stage: "EVO этабы",
    lifecycle: "Абалы",
    allLifecycle: "Бардык абалдар",
    apply: "Колдонуу",
    clear: "Тазалоо",
    lead: "Лид / кардар",
    owner: "EVO жооптуусу",
    source: "Булак",
    secondary: "Байланышкан контекст",
    updated: "Жаңыртылды",
    notAssigned: "Дайындалган эмес",
    noClient: "Кардар байланыша элек",
    conversations: "диалог",
    studentCases: "Student Cases",
    empty:
      "Жеткиликтүү уюмда каноникалык лиддер азырынча жок. Диалогдор жана тарыхый жазуулар лиддин ордуна коюлбайт.",
    first: "Башына",
    next: "Кийинки лиддер",
    found: "Бул бетте",
    duplicates: "Ачык дубликат менен",
    unowned: "Жооптуусу жок",
  },
  en: {
    title: "EVO leads",
    description:
      "The canonical lead register for your organization. Current stage and owner belong to EVO.",
    search: "Search client, contact, or EVO UUID",
    stage: "EVO stage",
    lifecycle: "Lifecycle",
    allLifecycle: "All lifecycle states",
    apply: "Apply",
    clear: "Clear",
    lead: "Lead / client",
    owner: "EVO owner",
    source: "Source",
    secondary: "Linked context",
    updated: "Updated",
    notAssigned: "Not assigned",
    noClient: "Client is not linked yet",
    conversations: "conversations",
    studentCases: "Student Cases",
    empty:
      "There are no canonical leads in your accessible organization yet. Conversations and historical records are not substituted for leads.",
    first: "Back to first",
    next: "Next leads",
    found: "On this page",
    duplicates: "With open duplicates",
    unowned: "Without an owner",
  },
} as const;

/** Connected U2 surface: canonical EVO leads only, with no conversation fallback. */
export async function ConnectedCanonicalSales({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
    searchParams,
  ]);
  const normalized = normalizeSearchParams(params);
  const page = await listPlatformCanonicalLeads(actor, {
    cursor: normalized.cursor,
    lifecycleState: normalized.lifecycle,
    pageSize: 50,
    query: normalized.query,
    stageKey: normalized.stage,
  });

  return (
    <CanonicalSalesPresentation
      locale={locale}
      rows={page.rows}
      params={normalized}
      hasNext={page.hasNext}
      nextCursor={page.nextCursor}
    />
  );
}

type NormalizedParams = Readonly<{
  cursor: PlatformCanonicalCursor | null;
  lifecycle?: PlatformCanonicalLeadLifecycleState;
  query?: string;
  stage?: string;
}>;

function normalizeSearchParams(params: SearchParams): NormalizedParams {
  assertOnlySearchKeys(params, [
    "before_at",
    "before_id",
    "lifecycle",
    "q",
    "stage",
  ]);
  const beforeAt = singleValue(params.before_at);
  const beforeId = singleValue(params.before_id);
  const lifecycle = trimmed(singleValue(params.lifecycle));
  const query = trimmed(singleValue(params.q));
  const stage = trimmed(singleValue(params.stage));
  if (
    lifecycle &&
    !PLATFORM_CANONICAL_LEAD_LIFECYCLE_STATES.includes(
      lifecycle as PlatformCanonicalLeadLifecycleState,
    )
  ) {
    throw new PlatformCanonicalRecordsRepositoryError();
  }
  return {
    cursor: parsePlatformCanonicalCursor(beforeAt ?? null, beforeId ?? null),
    lifecycle: lifecycle as PlatformCanonicalLeadLifecycleState | undefined,
    query,
    stage,
  };
}

function assertOnlySearchKeys(
  params: SearchParams,
  allowedKeys: readonly string[],
) {
  if (Object.keys(params).some((key) => !allowedKeys.includes(key))) {
    throw new PlatformCanonicalRecordsRepositoryError();
  }
}

function singleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) throw new PlatformCanonicalRecordsRepositoryError();
  return value;
}

function trimmed(value: string | undefined) {
  const result = value?.trim();
  return result ? result : undefined;
}

function CanonicalSalesPresentation({
  locale,
  rows,
  params,
  hasNext,
  nextCursor,
}: Readonly<{
  locale: Locale;
  rows: readonly PlatformCanonicalLeadSummary[];
  params: NormalizedParams;
  hasNext: boolean;
  nextCursor: PlatformCanonicalCursor | null;
}>) {
  const copy = COPY[locale];
  const shared = canonicalRecordCopy(locale);
  const duplicateCount = rows.filter((lead) => lead.hasOpenDuplicateCandidates).length;
  const unownedCount = rows.filter(
    (lead) => lead.currentOwnerMembershipId === null,
  ).length;

  return (
    <div className="min-w-0 space-y-5" data-testid="canonical-sales-page">
      <PageHeader title={copy.title} description={copy.description} />
      <CanonicalAuthorityNotice locale={locale} />

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-[12px] text-fg-3">
        <Metric label={copy.found} value={rows.length} />
        <Metric label={copy.duplicates} value={duplicateCount} />
        <Metric label={copy.unowned} value={unownedCount} />
      </div>

      <form
        action="/sales"
        method="get"
        className={`${filterBarCls} sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_minmax(170px,0.45fr)_minmax(180px,0.45fr)_auto]`}
        aria-label={copy.title}
      >
        <input
          className={inputCls}
          name="q"
          defaultValue={params.query}
          placeholder={copy.search}
          aria-label={copy.search}
        />
        <input
          className={inputCls}
          name="stage"
          defaultValue={params.stage}
          placeholder={copy.stage}
          aria-label={copy.stage}
        />
        <select
          className={inputCls}
          name="lifecycle"
          defaultValue={params.lifecycle ?? ""}
          aria-label={copy.lifecycle}
        >
          <option value="">{copy.allLifecycle}</option>
          {PLATFORM_CANONICAL_LEAD_LIFECYCLE_STATES.map((state) => (
            <option key={state} value={state}>
              {humanizeCanonicalKey(state)}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="submit" className={btnCls}>
            <Icon name="search" size={15} /> {copy.apply}
          </button>
          <Link href="/sales" className={btnGhostCls}>
            {copy.clear}
          </Link>
        </div>
      </form>

      <section aria-label={copy.title} data-testid="canonical-lead-list">
        {rows.length === 0 ? (
          <div className="border-y border-border" data-testid="canonical-leads-empty">
            <EmptyState text={copy.empty} />
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto border-y border-border">
            <table className="w-full min-w-[900px] text-left text-[12.5px]">
              <thead className="border-b border-border bg-surface-2 text-[10.5px] uppercase tracking-[0.04em] text-fg-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">{copy.lead}</th>
                  <th className="px-3 py-3 font-semibold">{copy.stage}</th>
                  <th className="px-3 py-3 font-semibold">{copy.owner}</th>
                  <th className="px-3 py-3 font-semibold">{copy.source}</th>
                  <th className="px-3 py-3 font-semibold">{copy.secondary}</th>
                  <th className="px-4 py-3 font-semibold">{copy.updated}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((lead) => (
                  <tr
                    key={lead.id}
                    className="transition-colors hover:bg-surface-2"
                    data-testid="canonical-lead-row"
                    data-lead-id={lead.id}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/sales/${lead.id}`}
                        className="font-semibold text-fg hover:text-accent"
                        aria-label={`${lead.clientDisplayName ?? copy.noClient} · ${lead.id}`}
                      >
                        {lead.clientDisplayName ?? copy.noClient}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <CanonicalUuid value={lead.id} />
                        <DuplicateStatus
                          count={lead.openDuplicateCandidateCount}
                          locale={locale}
                        />
                      </div>
                      <div className="mt-1 text-[11.5px] text-fg-3">
                        {[lead.clientEmail, lead.clientPhone].filter(Boolean).join(" · ") ||
                          shared.unavailable}
                      </div>
                    </td>
                    <td className="px-3 py-3" data-testid="canonical-lead-stage">
                      <CanonicalKeyBadge value={lead.stageKey} tone="accent" />
                      <div className="mt-1">
                        <CanonicalKeyBadge value={lead.lifecycleState} />
                      </div>
                    </td>
                    <td className="px-3 py-3" data-testid="canonical-lead-owner">
                      <div className="font-medium text-fg-2">
                        {lead.currentOwnerDisplayName ?? copy.notAssigned}
                      </div>
                      {lead.currentOwnerMembershipId ? (
                        <div className="mt-1">
                          <CanonicalUuid value={lead.currentOwnerMembershipId} />
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-fg-2">
                      {humanizeCanonicalKey(lead.sourceKey)}
                    </td>
                    <td className="px-3 py-3 text-[11.5px] text-fg-3">
                      <div>{lead.linkedConversationCount} {copy.conversations}</div>
                      <div className="mt-1">
                        {lead.linkedStudentCaseCount} {copy.studentCases}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-fg-3">
                      {formatCanonicalTimestamp(lead.updatedAt, locale)}
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
          <Link href={salesHref(params)} className={btnGhostCls}>
            ← {copy.first}
          </Link>
        ) : (
          <span />
        )}
        {hasNext && nextCursor ? (
          <Link href={salesHref(params, nextCursor)} className={btnGhostCls} rel="next">
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

function salesHref(params: NormalizedParams, cursor?: PlatformCanonicalCursor) {
  const query = new URLSearchParams();
  if (params.query) query.set("q", params.query);
  if (params.stage) query.set("stage", params.stage);
  if (params.lifecycle) query.set("lifecycle", params.lifecycle);
  if (cursor) {
    query.set("before_at", cursor.updatedAt);
    query.set("before_id", cursor.id);
  }
  const serialized = query.toString();
  return serialized ? `/sales?${serialized}` : "/sales";
}
