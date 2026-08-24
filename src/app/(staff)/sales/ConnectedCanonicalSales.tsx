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
import {
  PLATFORM_SALES_INTAKE_STATES,
  PlatformSalesIntakeRepositoryError,
  listPlatformSalesIntake,
  parsePlatformSalesIntakeCursor,
  type PlatformSalesIntakeCursor,
  type PlatformSalesIntakePage,
  type PlatformSalesIntakeRow,
  type PlatformSalesIntakeState,
} from "@/lib/platform-sales-intake";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  intake_before_at?: string | string[];
  intake_before_id?: string | string[];
  intake_q?: string | string[];
  intake_state?: string | string[];
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
    intakeTitle: "Входящие WhatsApp",
    intakeDescription:
      "Receive-only очередь: здесь виден результат приёма, но нет отправки, автоответов и изменения лида.",
    intakeSearch: "Поиск по имени, теме или тексту сообщения",
    intakeState: "Состояние приёма",
    intakeAllStates: "Все состояния приёма",
    intakeEmpty: "Входящих обращений по этим условиям пока нет.",
    intakeUnavailable:
      "Очередь входящих сейчас недоступна. Канонический реестр лидов ниже остаётся отдельным источником данных.",
    intakeInvalid:
      "Параметры фильтра входящих некорректны. Сбросьте фильтр; канонический реестр лидов ниже продолжает работать.",
    intakeContact: "Обращение",
    intakeStatus: "Состояние",
    intakeLinked: "Каноническая связь",
    intakeObserved: "Получено",
    intakeNoContact: "Контакт ещё не определён",
    intakeNoMessage: "Текст сообщения недоступен",
    intakeNoLink: "Каноническая связь ещё не создана",
    intakeOpenConversation: "Открыть переписку",
    intakeOpenLead: "Открыть лид",
    intakeAttempts: "Попыток обработки",
    intakeError: "Код ошибки",
    intakeFirst: "К новым обращениям",
    intakeNext: "Более ранние обращения",
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
    intakeTitle: "Кирген WhatsApp кайрылуулары",
    intakeDescription:
      "Receive-only кезек: кабыл алуу натыйжасы көрүнөт, бирок жөнөтүү, авто-жооп жана лидди өзгөртүү жок.",
    intakeSearch: "Аты, темасы же билдирүү тексти боюнча издөө",
    intakeState: "Кабыл алуу абалы",
    intakeAllStates: "Бардык кабыл алуу абалдары",
    intakeEmpty: "Бул шарттар боюнча кирген кайрылуулар азырынча жок.",
    intakeUnavailable:
      "Кирген кайрылуулар кезеги азыр жеткиликсиз. Төмөндөгү каноникалык лиддер реестри өзүнчө маалымат булагы бойдон калат.",
    intakeInvalid:
      "Кирген кайрылуулардын чыпка параметрлери туура эмес. Чыпканы тазалаңыз; төмөндөгү каноникалык лиддер реестри иштей берет.",
    intakeContact: "Кайрылуу",
    intakeStatus: "Абалы",
    intakeLinked: "Каноникалык байланыш",
    intakeObserved: "Кабыл алынды",
    intakeNoContact: "Байланыш азырынча аныкталган жок",
    intakeNoMessage: "Билдирүүнүн тексти жеткиликсиз",
    intakeNoLink: "Каноникалык байланыш азырынча түзүлгөн жок",
    intakeOpenConversation: "Кат алышууну ачуу",
    intakeOpenLead: "Лидди ачуу",
    intakeAttempts: "Иштетүү аракеттери",
    intakeError: "Ката коду",
    intakeFirst: "Жаңы кайрылууларга",
    intakeNext: "Мурунку кайрылуулар",
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
    intakeTitle: "Incoming WhatsApp",
    intakeDescription:
      "Receive-only queue: intake results are visible here, with no sending, auto-replies, or lead mutations.",
    intakeSearch: "Search name, subject, or message text",
    intakeState: "Intake state",
    intakeAllStates: "All intake states",
    intakeEmpty: "There are no incoming requests matching these filters yet.",
    intakeUnavailable:
      "The incoming queue is unavailable. The canonical lead register below remains a separate data source.",
    intakeInvalid:
      "The incoming filter parameters are invalid. Clear the filter; the canonical lead register below remains available.",
    intakeContact: "Request",
    intakeStatus: "State",
    intakeLinked: "Canonical link",
    intakeObserved: "Received",
    intakeNoContact: "Contact is not identified yet",
    intakeNoMessage: "Message text is unavailable",
    intakeNoLink: "A canonical link has not been created yet",
    intakeOpenConversation: "Open transcript",
    intakeOpenLead: "Open lead",
    intakeAttempts: "Processing attempts",
    intakeError: "Error code",
    intakeFirst: "Back to newest",
    intakeNext: "Earlier requests",
  },
} as const;

const INTAKE_STATE_COPY: Record<
  Locale,
  Record<PlatformSalesIntakeState, string>
> = {
  ru: {
    queued: "queued · в очереди",
    retrying: "retrying · повторная обработка",
    received: "received · принято",
    manual_review: "manual_review · нужна ручная проверка",
    unsupported: "unsupported · формат не поддерживается",
    terminal_failure: "terminal_failure · обработка остановлена",
  },
  ky: {
    queued: "queued · кезекте",
    retrying: "retrying · кайра иштетүү",
    received: "received · кабыл алынды",
    manual_review: "manual_review · кол менен текшерүү керек",
    unsupported: "unsupported · формат колдоого алынбайт",
    terminal_failure: "terminal_failure · иштетүү токтотулду",
  },
  en: {
    queued: "queued",
    retrying: "retrying",
    received: "received",
    manual_review: "manual_review · manual review",
    unsupported: "unsupported",
    terminal_failure: "terminal_failure",
  },
};

/** Connected U3 surface: canonical EVO leads plus a bounded receive-only intake queue. */
export async function ConnectedCanonicalSales({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
    searchParams,
  ]);
  const normalized = normalizeSearchParams(params);
  const intakeRead = normalized.intakeInvalid
    ? Promise.resolve({ page: null, unavailable: false as const })
    : listPlatformSalesIntake(actor, {
        cursor: normalized.intakeCursor,
        pageSize: 50,
        query: normalized.intakeQuery,
        state: normalized.intakeState,
      })
        .then((intakePage) => ({ page: intakePage, unavailable: false as const }))
        .catch((error: unknown) => {
          if (error instanceof PlatformSalesIntakeRepositoryError) {
            return { page: null, unavailable: true as const };
          }
          throw error;
        });
  const [page, intakeResult] = await Promise.all([
    listPlatformCanonicalLeads(actor, {
      cursor: normalized.cursor,
      lifecycleState: normalized.lifecycle,
      pageSize: 50,
      query: normalized.query,
      stageKey: normalized.stage,
    }),
    intakeRead,
  ]);

  return (
    <CanonicalSalesPresentation
      locale={locale}
      rows={page.rows}
      params={normalized}
      hasNext={page.hasNext}
      nextCursor={page.nextCursor}
      intakePage={intakeResult.page}
      intakeUnavailable={intakeResult.unavailable}
      intakeInvalid={normalized.intakeInvalid}
    />
  );
}

type NormalizedParams = Readonly<{
  cursor: PlatformCanonicalCursor | null;
  intakeCursor: PlatformSalesIntakeCursor | null;
  intakeInvalid: boolean;
  intakeQuery?: string;
  intakeState?: PlatformSalesIntakeState;
  lifecycle?: PlatformCanonicalLeadLifecycleState;
  query?: string;
  stage?: string;
}>;

function normalizeSearchParams(params: SearchParams): NormalizedParams {
  assertOnlySearchKeys(params, [
    "before_at",
    "before_id",
    "intake_before_at",
    "intake_before_id",
    "intake_q",
    "intake_state",
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
  const intake = normalizeIntakeSearchParams(params);
  return {
    cursor: parsePlatformCanonicalCursor(beforeAt ?? null, beforeId ?? null),
    ...intake,
    lifecycle: lifecycle as PlatformCanonicalLeadLifecycleState | undefined,
    query,
    stage,
  };
}

function normalizeIntakeSearchParams(
  params: SearchParams,
): Pick<
  NormalizedParams,
  "intakeCursor" | "intakeInvalid" | "intakeQuery" | "intakeState"
> {
  try {
    const beforeAt = singleIntakeValue(params.intake_before_at);
    const beforeId = singleIntakeValue(params.intake_before_id);
    const query = trimmed(singleIntakeValue(params.intake_q));
    const state = trimmed(singleIntakeValue(params.intake_state));
    if (query && query.length > 200) {
      throw new PlatformSalesIntakeRepositoryError();
    }
    if (
      state &&
      !PLATFORM_SALES_INTAKE_STATES.includes(state as PlatformSalesIntakeState)
    ) {
      throw new PlatformSalesIntakeRepositoryError();
    }
    return {
      intakeCursor: parsePlatformSalesIntakeCursor(beforeAt, beforeId),
      intakeInvalid: false,
      intakeQuery: query,
      intakeState: state as PlatformSalesIntakeState | undefined,
    };
  } catch (error) {
    if (error instanceof PlatformSalesIntakeRepositoryError) {
      return {
        intakeCursor: null,
        intakeInvalid: true,
        intakeQuery: undefined,
        intakeState: undefined,
      };
    }
    throw error;
  }
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

function singleIntakeValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) throw new PlatformSalesIntakeRepositoryError();
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
  intakePage,
  intakeUnavailable,
  intakeInvalid,
}: Readonly<{
  locale: Locale;
  rows: readonly PlatformCanonicalLeadSummary[];
  params: NormalizedParams;
  hasNext: boolean;
  nextCursor: PlatformCanonicalCursor | null;
  intakePage: PlatformSalesIntakePage | null;
  intakeUnavailable: boolean;
  intakeInvalid: boolean;
}>) {
  const copy = COPY[locale];
  const shared = canonicalRecordCopy(locale);
  const duplicateCount = rows.filter((lead) => lead.hasOpenDuplicateCandidates).length;
  const unownedCount = rows.filter(
    (lead) => lead.currentOwnerMembershipId === null,
  ).length;

  return (
    <div className="min-w-0" data-testid="platform-sales-page">
      <div className="space-y-5" data-testid="canonical-sales-page">
      <PageHeader title={copy.title} description={copy.description} />
      <CanonicalAuthorityNotice locale={locale} />

      <SalesIntakeQueue
        locale={locale}
        page={intakePage}
        params={params}
        unavailable={intakeUnavailable}
        invalid={intakeInvalid}
      />

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
          <Link
            href={salesHref(params, { includeCanonical: false })}
            className={btnGhostCls}
          >
            {copy.clear}
          </Link>
        </div>
        <IntakeFilterHiddenInputs params={params} />
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
          <Link
            href={salesHref(params, { canonicalCursor: null })}
            className={btnGhostCls}
          >
            ← {copy.first}
          </Link>
        ) : (
          <span />
        )}
        {hasNext && nextCursor ? (
          <Link
            href={salesHref(params, { canonicalCursor: nextCursor })}
            className={btnGhostCls}
            rel="next"
          >
            {copy.next} →
          </Link>
        ) : null}
      </nav>
      </div>
    </div>
  );
}

function SalesIntakeQueue({
  locale,
  page,
  params,
  unavailable,
  invalid,
}: Readonly<{
  locale: Locale;
  page: PlatformSalesIntakePage | null;
  params: NormalizedParams;
  unavailable: boolean;
  invalid: boolean;
}>) {
  const copy = COPY[locale];

  return (
    <section
      className="space-y-4 border-y border-border py-4"
      aria-labelledby="sales-intake-title"
      data-testid="platform-sales-intake"
    >
      <div className="space-y-1">
        <h2 id="sales-intake-title" className="text-[15px] font-semibold text-fg">
          {copy.intakeTitle}
        </h2>
        <p className="max-w-4xl text-[12.5px] leading-5 text-fg-3">
          {copy.intakeDescription}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" aria-label={copy.intakeState}>
        {PLATFORM_SALES_INTAKE_STATES.map((state) => (
          <span
            key={state}
            className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] text-fg-2"
          >
            {INTAKE_STATE_COPY[locale][state]}
          </span>
        ))}
      </div>

      <form
        action="/sales"
        method="get"
        className={`${filterBarCls} sm:grid-cols-[minmax(260px,1fr)_minmax(220px,0.55fr)_auto]`}
        aria-label={copy.intakeTitle}
      >
        <input
          className={inputCls}
          name="intake_q"
          defaultValue={params.intakeQuery}
          maxLength={200}
          placeholder={copy.intakeSearch}
          aria-label={copy.intakeSearch}
        />
        <select
          className={inputCls}
          name="intake_state"
          defaultValue={params.intakeState ?? ""}
          aria-label={copy.intakeState}
        >
          <option value="">{copy.intakeAllStates}</option>
          {PLATFORM_SALES_INTAKE_STATES.map((state) => (
            <option key={state} value={state}>
              {INTAKE_STATE_COPY[locale][state]}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="submit" className={btnCls}>
            <Icon name="search" size={15} /> {copy.apply}
          </button>
          <Link
            href={salesHref(params, { includeIntake: false })}
            className={btnGhostCls}
          >
            {copy.clear}
          </Link>
        </div>
        <CanonicalFilterHiddenInputs params={params} />
      </form>

      {unavailable || invalid || page === null ? (
        <div
          className="border-l-[3px] border-warn bg-warn-weak px-4 py-3 text-[12.5px] leading-5 text-fg-2"
          data-testid="sales-intake-unavailable"
        >
          {invalid ? copy.intakeInvalid : copy.intakeUnavailable}
        </div>
      ) : page.rows.length === 0 ? (
        <div data-testid="sales-intake-empty">
          <EmptyState text={copy.intakeEmpty} />
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[12.5px]">
            <thead className="border-b border-border bg-surface-2 text-[10.5px] uppercase tracking-[0.04em] text-fg-3">
              <tr>
                <th className="px-4 py-3 font-semibold">{copy.intakeContact}</th>
                <th className="px-3 py-3 font-semibold">{copy.intakeStatus}</th>
                <th className="px-3 py-3 font-semibold">{copy.intakeLinked}</th>
                <th className="px-4 py-3 font-semibold">{copy.intakeObserved}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {page.rows.map((row) => (
                <SalesIntakeRow key={row.workItemId} locale={locale} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page ? (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label={copy.intakeTitle}
        >
          {params.intakeCursor ? (
            <Link
              href={salesHref(params, { intakeCursor: null })}
              className={btnGhostCls}
            >
              ← {copy.intakeFirst}
            </Link>
          ) : (
            <span />
          )}
          {page.hasNext && page.nextCursor ? (
            <Link
              href={salesHref(params, { intakeCursor: page.nextCursor })}
              className={btnGhostCls}
              rel="next"
            >
              {copy.intakeNext} →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}

function SalesIntakeRow({
  locale,
  row,
}: Readonly<{ locale: Locale; row: PlatformSalesIntakeRow }>) {
  const copy = COPY[locale];
  const transcriptHref =
    row.canonicalLeadId && row.conversationId
      ? `/sales/${row.canonicalLeadId}/conversations/${row.conversationId}`
      : null;

  return (
    <tr
      className="align-top transition-colors hover:bg-surface-2"
      data-testid="platform-sales-intake-row"
      data-intake-state={row.state}
    >
      <td className="px-4 py-3">
        <div className="font-semibold text-fg">
          {row.clientDisplayName ?? row.subject ?? copy.intakeNoContact}
        </div>
        {row.subject && row.subject !== row.clientDisplayName ? (
          <div className="mt-1 text-[11.5px] text-fg-3">{row.subject}</div>
        ) : null}
        <p className="mt-2 max-w-xl whitespace-pre-wrap break-words text-[12px] leading-5 text-fg-2">
          {row.messagePreview ?? copy.intakeNoMessage}
        </p>
      </td>
      <td className="px-3 py-3">
        <CanonicalKeyBadge value={row.state} tone={intakeStateTone(row.state)} />
        <div className="mt-2 font-mono text-[10.5px] text-fg-3">
          {INTAKE_STATE_COPY[locale][row.state]}
        </div>
        <div className="mt-2 text-[11.5px] text-fg-3">
          {copy.intakeAttempts}: {row.attemptCount}
        </div>
        {row.errorCode ? (
          <div className="mt-1 text-[11.5px] text-danger">
            {copy.intakeError}: <span className="font-mono">{row.errorCode}</span>
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3">
        {transcriptHref ? (
          <div className="space-y-2">
            <Link
              href={transcriptHref}
              className="block font-semibold text-accent hover:underline"
            >
              {copy.intakeOpenConversation}
            </Link>
            <Link
              href={`/sales/${row.canonicalLeadId}`}
              className="block text-[11.5px] text-fg-2 hover:text-accent hover:underline"
            >
              {copy.intakeOpenLead}
            </Link>
          </div>
        ) : row.canonicalLeadId ? (
          <Link
            href={`/sales/${row.canonicalLeadId}`}
            className="font-semibold text-accent hover:underline"
          >
            {copy.intakeOpenLead}
          </Link>
        ) : (
          <span className="text-[11.5px] text-fg-3">{copy.intakeNoLink}</span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-[11px] text-fg-3">
        {formatCanonicalTimestamp(row.providerOccurredAt, locale)}
      </td>
    </tr>
  );
}

function intakeStateTone(state: PlatformSalesIntakeState) {
  switch (state) {
    case "received":
      return "ok" as const;
    case "manual_review":
    case "retrying":
      return "warn" as const;
    case "terminal_failure":
      return "danger" as const;
    case "queued":
      return "accent" as const;
    case "unsupported":
      return "neutral" as const;
  }
}

function CanonicalFilterHiddenInputs({
  params,
}: Readonly<{ params: NormalizedParams }>) {
  return (
    <>
      {params.query ? <input type="hidden" name="q" value={params.query} /> : null}
      {params.stage ? <input type="hidden" name="stage" value={params.stage} /> : null}
      {params.lifecycle ? (
        <input type="hidden" name="lifecycle" value={params.lifecycle} />
      ) : null}
      {params.cursor ? (
        <>
          <input type="hidden" name="before_at" value={params.cursor.updatedAt} />
          <input type="hidden" name="before_id" value={params.cursor.id} />
        </>
      ) : null}
    </>
  );
}

function IntakeFilterHiddenInputs({
  params,
}: Readonly<{ params: NormalizedParams }>) {
  return (
    <>
      {params.intakeQuery ? (
        <input type="hidden" name="intake_q" value={params.intakeQuery} />
      ) : null}
      {params.intakeState ? (
        <input type="hidden" name="intake_state" value={params.intakeState} />
      ) : null}
      {params.intakeCursor ? (
        <>
          <input
            type="hidden"
            name="intake_before_at"
            value={params.intakeCursor.sortAt}
          />
          <input
            type="hidden"
            name="intake_before_id"
            value={params.intakeCursor.workItemId}
          />
        </>
      ) : null}
    </>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <span>
      {label}: <strong className="font-mono text-fg">{value}</strong>
    </span>
  );
}

function salesHref(
  params: NormalizedParams,
  options: Readonly<{
    canonicalCursor?: PlatformCanonicalCursor | null;
    intakeCursor?: PlatformSalesIntakeCursor | null;
    includeCanonical?: boolean;
    includeIntake?: boolean;
  }> = {},
) {
  const query = new URLSearchParams();
  if (options.includeCanonical !== false) {
    if (params.query) query.set("q", params.query);
    if (params.stage) query.set("stage", params.stage);
    if (params.lifecycle) query.set("lifecycle", params.lifecycle);
    const canonicalCursor = Object.hasOwn(options, "canonicalCursor")
      ? options.canonicalCursor
      : params.cursor;
    if (canonicalCursor) {
      query.set("before_at", canonicalCursor.updatedAt);
      query.set("before_id", canonicalCursor.id);
    }
  }
  if (options.includeIntake !== false) {
    if (params.intakeQuery) query.set("intake_q", params.intakeQuery);
    if (params.intakeState) query.set("intake_state", params.intakeState);
    const intakeCursor = Object.hasOwn(options, "intakeCursor")
      ? options.intakeCursor
      : params.intakeCursor;
    if (intakeCursor) {
      query.set("intake_before_at", intakeCursor.sortAt);
      query.set("intake_before_id", intakeCursor.workItemId);
    }
  }
  const serialized = query.toString();
  return serialized ? `/sales?${serialized}` : "/sales";
}
