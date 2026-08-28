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
  PLATFORM_CANONICAL_CLIENT_LIFECYCLE_STATES,
  PlatformCanonicalRecordsRepositoryError,
  listPlatformCanonicalClients,
  parsePlatformCanonicalCursor,
  type PlatformCanonicalClientLifecycleState,
  type PlatformCanonicalClientSummary,
  type PlatformCanonicalCursor,
} from "@/lib/platform-canonical-records";
import { requirePlatformClientsActor } from "@/lib/platform-guards";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  lifecycle?: string | string[];
  q?: string | string[];
}>;

const COPY = {
  ru: {
    title: "Клиенты EVO",
    description:
      "Канонический реестр людей в EVO. Лиды, Student Cases и диалоги показаны как связанные записи, а не как личность клиента.",
    search: "Поиск по имени, контакту или EVO UUID",
    lifecycle: "Состояние",
    allLifecycle: "Все состояния",
    apply: "Применить",
    clear: "Сбросить",
    client: "Клиент EVO",
    contacts: "Контакты",
    linkedLeads: "Лиды",
    secondary: "Связанный контекст",
    updated: "Обновлено",
    conversations: "диалогов",
    studentCases: "Student Cases",
    empty:
      "Канонических клиентов в доступной вам организации пока нет. Student Cases и разговоры не подставляются вместо личности клиента.",
    first: "К началу",
    next: "Следующие клиенты",
    found: "На странице",
    duplicates: "С открытыми дублями",
    linked: "Со связанными лидами",
  },
  ky: {
    title: "EVO кардарлары",
    description:
      "EVOдогу адамдардын каноникалык реестри. Лиддер, Student Cases жана диалогдор кардардын инсандыгы эмес, байланышкан жазуулар катары көрсөтүлөт.",
    search: "Аты, байланыш же EVO UUID боюнча издөө",
    lifecycle: "Абалы",
    allLifecycle: "Бардык абалдар",
    apply: "Колдонуу",
    clear: "Тазалоо",
    client: "EVO кардары",
    contacts: "Байланыштар",
    linkedLeads: "Лиддер",
    secondary: "Байланышкан контекст",
    updated: "Жаңыртылды",
    conversations: "диалог",
    studentCases: "Student Cases",
    empty:
      "Жеткиликтүү уюмда каноникалык кардарлар азырынча жок. Student Cases жана диалогдор кардардын инсандыгынын ордуна коюлбайт.",
    first: "Башына",
    next: "Кийинки кардарлар",
    found: "Бул бетте",
    duplicates: "Ачык дубликат менен",
    linked: "Лиди байланышкан",
  },
  en: {
    title: "EVO clients",
    description:
      "The canonical people register in EVO. Leads, Student Cases, and conversations are linked records, not the client's identity.",
    search: "Search name, contact, or EVO UUID",
    lifecycle: "Lifecycle",
    allLifecycle: "All lifecycle states",
    apply: "Apply",
    clear: "Clear",
    client: "EVO client",
    contacts: "Contacts",
    linkedLeads: "Leads",
    secondary: "Linked context",
    updated: "Updated",
    conversations: "conversations",
    studentCases: "Student Cases",
    empty:
      "There are no canonical clients in your accessible organization yet. Student Cases and conversations are not substituted for client identity.",
    first: "Back to first",
    next: "Next clients",
    found: "On this page",
    duplicates: "With open duplicates",
    linked: "With linked leads",
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
  const page = await listPlatformCanonicalClients(actor, {
    cursor: normalized.cursor,
    lifecycleState: normalized.lifecycle,
    pageSize: 50,
    query: normalized.query,
  });

  return (
    <CanonicalClientsPresentation
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
  lifecycle?: PlatformCanonicalClientLifecycleState;
  query?: string;
}>;

function normalizeSearchParams(params: SearchParams): NormalizedParams {
  assertOnlySearchKeys(params, ["before_at", "before_id", "lifecycle", "q"]);
  const beforeAt = singleValue(params.before_at);
  const beforeId = singleValue(params.before_id);
  const lifecycle = trimmed(singleValue(params.lifecycle));
  if (
    lifecycle &&
    !PLATFORM_CANONICAL_CLIENT_LIFECYCLE_STATES.includes(
      lifecycle as PlatformCanonicalClientLifecycleState,
    )
  ) {
    throw new PlatformCanonicalRecordsRepositoryError();
  }
  return {
    cursor: parsePlatformCanonicalCursor(beforeAt ?? null, beforeId ?? null),
    lifecycle: lifecycle as PlatformCanonicalClientLifecycleState | undefined,
    query: trimmed(singleValue(params.q)),
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

function CanonicalClientsPresentation({
  locale,
  rows,
  params,
  hasNext,
  nextCursor,
}: Readonly<{
  locale: Locale;
  rows: readonly PlatformCanonicalClientSummary[];
  params: NormalizedParams;
  hasNext: boolean;
  nextCursor: PlatformCanonicalCursor | null;
}>) {
  const copy = COPY[locale];
  const shared = canonicalRecordCopy(locale);
  const duplicateCount = rows.filter(
    (client) => client.hasOpenDuplicateCandidates,
  ).length;
  const linkedCount = rows.filter((client) => client.linkedLeadCount > 0).length;

  return (
    <div className="min-w-0 space-y-5" data-testid="canonical-clients-page">
      <PageHeader title={copy.title} description={copy.description} />
      <CanonicalAuthorityNotice locale={locale} />

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-[12px] text-fg-3">
        <Metric label={copy.found} value={rows.length} />
        <Metric label={copy.duplicates} value={duplicateCount} />
        <Metric label={copy.linked} value={linkedCount} />
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
          name="lifecycle"
          defaultValue={params.lifecycle ?? ""}
          aria-label={copy.lifecycle}
        >
          <option value="">{copy.allLifecycle}</option>
          {PLATFORM_CANONICAL_CLIENT_LIFECYCLE_STATES.map((state) => (
            <option key={state} value={state}>
              {humanizeCanonicalKey(state)}
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

      <section aria-label={copy.title} data-testid="canonical-client-list">
        {rows.length === 0 ? (
          <div className="border-y border-border" data-testid="canonical-clients-empty">
            <EmptyState text={copy.empty} />
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto border-y border-border">
            <table className="w-full min-w-[820px] text-left text-[12.5px]">
              <thead className="border-b border-border bg-surface-2 text-[10.5px] uppercase tracking-[0.04em] text-fg-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">{copy.client}</th>
                  <th className="px-3 py-3 font-semibold">{copy.contacts}</th>
                  <th className="px-3 py-3 font-semibold">{copy.lifecycle}</th>
                  <th className="px-3 py-3 font-semibold">{copy.linkedLeads}</th>
                  <th className="px-3 py-3 font-semibold">{copy.secondary}</th>
                  <th className="px-4 py-3 font-semibold">{copy.updated}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((client) => (
                  <tr
                    key={client.id}
                    className="transition-colors hover:bg-surface-2"
                    data-testid="canonical-client-row"
                    data-client-id={client.id}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/clients/${client.id}`}
                        className="font-semibold text-fg hover:text-accent"
                        aria-label={`${client.displayName} · ${client.id}`}
                      >
                        {client.displayName}
                      </Link>
                      <div className="mt-1">
                        <CanonicalUuid value={client.id} />
                      </div>
                      <div className="mt-1">
                        <DuplicateStatus
                          count={client.openDuplicateCandidateCount}
                          locale={locale}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-fg-2">
                      <div>{client.email ?? shared.unavailable}</div>
                      <div className="mt-1 text-[11.5px] text-fg-3">
                        {client.phone ?? shared.unavailable}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <CanonicalKeyBadge value={client.lifecycleState} tone="accent" />
                    </td>
                    <td className="px-3 py-3 font-mono font-semibold text-fg-2">
                      {client.linkedLeadCount}
                    </td>
                    <td className="px-3 py-3 text-[11.5px] text-fg-3">
                      <div>{client.linkedConversationCount} {copy.conversations}</div>
                      <div className="mt-1">
                        {client.linkedStudentCaseCount} {copy.studentCases}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-fg-3">
                      {formatCanonicalTimestamp(client.updatedAt, locale)}
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

function clientsHref(params: NormalizedParams, cursor?: PlatformCanonicalCursor) {
  const query = new URLSearchParams();
  if (params.query) query.set("q", params.query);
  if (params.lifecycle) query.set("lifecycle", params.lifecycle);
  if (cursor) {
    query.set("before_at", cursor.updatedAt);
    query.set("before_id", cursor.id);
  }
  const serialized = query.toString();
  return serialized ? `/clients?${serialized}` : "/clients";
}
