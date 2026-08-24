import { randomUUID } from "node:crypto";

import Link from "next/link";

import { Icon } from "@/components/icons";
import { SalesLeadWorkflowForm } from "@/components/platform/sales/SalesLeadWorkflowForm";
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
  PLATFORM_SALES_INTAKE_STATES,
  PlatformSalesIntakeRepositoryError,
  listPlatformSalesIntake,
  parsePlatformSalesIntakeCursor,
  type PlatformSalesIntakeCursor,
  type PlatformSalesIntakePage,
  type PlatformSalesIntakeRow,
  type PlatformSalesIntakeState,
} from "@/lib/platform-sales-intake";
import {
  PLATFORM_SALES_ASSIGNMENT_FILTERS,
  PLATFORM_SALES_CONNECTION_FILTERS,
  PLATFORM_SALES_DUE_FILTERS,
  PLATFORM_SALES_STAGES,
  PlatformSalesWorkflowRepositoryError,
  listPlatformSalesLeads,
  listPlatformSalesOwnerOptions,
  parsePlatformSalesUuid,
  parsePlatformSalesWorkflowCursor,
  type PlatformSalesAssignmentFilter,
  type PlatformSalesConnectionFilter,
  type PlatformSalesDueFilter,
  type PlatformSalesLeadPage,
  type PlatformSalesLeadWorkflow,
  type PlatformSalesOwnerOption,
  type PlatformSalesStage,
  type PlatformSalesWorkflowCursor,
} from "@/lib/platform-sales-workflow";
import { requirePlatformSalesActor } from "@/lib/platform-guards";

type SearchParams = Readonly<{
  assignment?: string | string[];
  before_at?: string | string[];
  before_id?: string | string[];
  connection?: string | string[];
  due?: string | string[];
  intake_before_at?: string | string[];
  intake_before_id?: string | string[];
  intake_q?: string | string[];
  intake_state?: string | string[];
  owner?: string | string[];
  q?: string | string[];
  stage?: string | string[];
}>;

const COPY = {
  ru: {
    title: "Лиды EVO",
    description:
      "Единая очередь квалификации EVO: этап, ответственный и следующий шаг сохраняются в каноническом лиде.",
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
      "EVOнун бирдиктүү квалификация кезеги: этап, жооптуу жана кийинки кадам каноникалык лидде сакталат.",
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
      "The unified EVO qualification queue: stage, owner, and next action are stored on the canonical lead.",
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

const SALES_STAGE_COPY: Record<Locale, Record<PlatformSalesStage, string>> = {
  ru: {
    new: "Новый",
    contacting: "Связываемся",
    qualified: "Квалифицирован",
    meeting_scheduled: "Встреча назначена",
    meeting_completed: "Встреча проведена",
    potential: "Потенциальный клиент",
  },
  ky: {
    new: "Жаңы",
    contacting: "Байланышуудабыз",
    qualified: "Квалификациядан өттү",
    meeting_scheduled: "Жолугушуу дайындалды",
    meeting_completed: "Жолугушуу өттү",
    potential: "Потенциалдуу кардар",
  },
  en: {
    new: "New",
    contacting: "Contacting",
    qualified: "Qualified",
    meeting_scheduled: "Meeting scheduled",
    meeting_completed: "Meeting completed",
    potential: "Potential",
  },
};

const SALES_WORKFLOW_COPY = {
  ru: {
    queueTitle: "Квалификация и следующий шаг",
    queueDescription:
      "Connected означает прямую связь лида с перепиской EVO, а не состояние WhatsApp-провайдера.",
    connection: "Связь с перепиской",
    allConnections: "Все связи",
    connected: "Connected · есть прямая связь",
    unconnected: "Unconnected · прямой связи нет",
    allStages: "Все этапы",
    assignment: "Назначение",
    allAssignments: "Все доступные",
    mine: "Мои лиды",
    unassigned: "Без ответственного",
    ownerFilter: "Ответственный Sales",
    allOwners: "Все ответственные",
    due: "Срок следующего действия",
    allDue: "Все сроки",
    scheduled: "Действие запланировано",
    unscheduled: "Без следующего действия",
    dueToday: "Срок сегодня",
    overdueFilter: "Просрочено",
    lead: "Лид / клиент",
    stageOwner: "Этап / ответственный",
    nextAction: "Следующее действие",
    connectionContext: "Связь / контекст",
    updatedVersion: "Обновлено / версия",
    change: "Изменить",
    noAction: "Следующее действие не запланировано",
    noDueDate: "Срок не задан",
    overdue: "Просрочено",
    today: "Сегодня",
    version: "Версия",
    connectedShort: "Connected",
    unconnectedShort: "Unconnected",
    connectionHelpConnected: "Есть прямая каноническая связь с перепиской EVO.",
    connectionHelpUnconnected: "Прямой канонической связи с перепиской EVO нет.",
    invalid:
      "Параметры очереди некорректны. Сбросьте фильтры: данные не были заменены нефильтрованным списком.",
    unavailable:
      "Очередь квалификации сейчас недоступна. Это ошибка чтения, а не пустой результат.",
    empty: "В доступной вам очереди пока нет канонических лидов.",
    emptyConnected: "Нет лидов с прямой связью с перепиской EVO.",
    emptyUnconnected: "Нет лидов без прямой связи с перепиской EVO.",
    emptyOverdue: "Нет лидов с просроченным следующим действием.",
    emptyUnassigned: "Нет доступных лидов без ответственного.",
    emptyFiltered: "По выбранным условиям лиды не найдены.",
    ownerUnavailable:
      "Список допустимых ответственных недоступен. Очередь остаётся видимой, но сохранение отключено.",
    ownerTruncated:
      "Показаны первые 50 активных Sales. Используйте очередь без назначения отсутствующего в списке сотрудника.",
    conversations: "диалогов",
    studentCases: "Student Cases",
  },
  ky: {
    queueTitle: "Квалификация жана кийинки кадам",
    queueDescription:
      "Connected лиддин EVO кат алышуусу менен түз байланышын билдирет; бул WhatsApp провайдеринин абалы эмес.",
    connection: "Кат алышуу байланышы",
    allConnections: "Бардык байланыштар",
    connected: "Connected · түз байланыш бар",
    unconnected: "Unconnected · түз байланыш жок",
    allStages: "Бардык этаптар",
    assignment: "Дайындоо",
    allAssignments: "Бардык жеткиликтүү",
    mine: "Менин лиддерим",
    unassigned: "Жооптуусу жок",
    ownerFilter: "Sales жооптуусу",
    allOwners: "Бардык жооптуулар",
    due: "Кийинки аракеттин мөөнөтү",
    allDue: "Бардык мөөнөттөр",
    scheduled: "Аракет пландалган",
    unscheduled: "Кийинки аракет жок",
    dueToday: "Мөөнөт бүгүн",
    overdueFilter: "Мөөнөтү өткөн",
    lead: "Лид / кардар",
    stageOwner: "Этап / жооптуу",
    nextAction: "Кийинки аракет",
    connectionContext: "Байланыш / контекст",
    updatedVersion: "Жаңыртуу / версия",
    change: "Өзгөртүү",
    noAction: "Кийинки аракет пландалган эмес",
    noDueDate: "Мөөнөт берилген эмес",
    overdue: "Мөөнөтү өткөн",
    today: "Бүгүн",
    version: "Версия",
    connectedShort: "Connected",
    unconnectedShort: "Unconnected",
    connectionHelpConnected: "EVO кат алышуусу менен түз каноникалык байланыш бар.",
    connectionHelpUnconnected: "EVO кат алышуусу менен түз каноникалык байланыш жок.",
    invalid: "Кезек чыпкалары туура эмес. Чыпкаларды тазалаңыз.",
    unavailable: "Квалификация кезеги жеткиликсиз. Бул бош натыйжа эмес.",
    empty: "Жеткиликтүү кезекте каноникалык лиддер азырынча жок.",
    emptyConnected: "EVO кат алышуусу менен түз байланышкан лиддер жок.",
    emptyUnconnected: "EVO кат алышуусу менен түз байланышы жок лиддер жок.",
    emptyOverdue: "Мөөнөтү өткөн кийинки аракети бар лиддер жок.",
    emptyUnassigned: "Жооптуусу жок жеткиликтүү лиддер жок.",
    emptyFiltered: "Тандалган шарттар боюнча лиддер табылган жок.",
    ownerUnavailable:
      "Жооптуулар тизмеси жеткиликсиз. Кезек көрүнөт, бирок сактоо өчүрүлгөн.",
    ownerTruncated: "Алгачкы 50 активдүү Sales кызматкери көрсөтүлдү.",
    conversations: "диалог",
    studentCases: "Student Cases",
  },
  en: {
    queueTitle: "Qualification and next action",
    queueDescription:
      "Connected means a direct canonical link to an EVO conversation, not WhatsApp provider health.",
    connection: "Conversation link",
    allConnections: "All connections",
    connected: "Connected · direct link exists",
    unconnected: "Unconnected · no direct link",
    allStages: "All stages",
    assignment: "Assignment",
    allAssignments: "All accessible",
    mine: "My leads",
    unassigned: "Unassigned",
    ownerFilter: "Sales owner",
    allOwners: "All owners",
    due: "Next-action due date",
    allDue: "All due states",
    scheduled: "Action scheduled",
    unscheduled: "No next action",
    dueToday: "Due today",
    overdueFilter: "Overdue",
    lead: "Lead / client",
    stageOwner: "Stage / owner",
    nextAction: "Next action",
    connectionContext: "Connection / context",
    updatedVersion: "Updated / version",
    change: "Change",
    noAction: "No next action is scheduled",
    noDueDate: "No due date",
    overdue: "Overdue",
    today: "Today",
    version: "Version",
    connectedShort: "Connected",
    unconnectedShort: "Unconnected",
    connectionHelpConnected: "A direct canonical EVO conversation link exists.",
    connectionHelpUnconnected: "No direct canonical EVO conversation link exists.",
    invalid:
      "The queue parameters are invalid. Clear the filters; no unfiltered fallback was substituted.",
    unavailable:
      "The qualification queue is unavailable. This is a read failure, not an empty result.",
    empty: "There are no canonical leads in your accessible queue yet.",
    emptyConnected: "There are no leads with a direct EVO conversation link.",
    emptyUnconnected: "There are no leads without a direct EVO conversation link.",
    emptyOverdue: "There are no leads with an overdue next action.",
    emptyUnassigned: "There are no accessible unassigned leads.",
    emptyFiltered: "No leads match the selected filters.",
    ownerUnavailable:
      "Eligible owner options are unavailable. The queue remains visible, but saving is disabled.",
    ownerTruncated:
      "The first 50 active Sales owners are shown. Do not assign an owner missing from this list.",
    conversations: "conversations",
    studentCases: "Student Cases",
  },
} as const;

/** Connected U4 surface: one canonical qualification queue plus the U3 receive-only intake. */
export async function ConnectedCanonicalSales({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
    searchParams,
  ]);
  const normalized = normalizeSearchParams(params);
  const listInvalid =
    normalized.listInvalid ||
    (normalized.ownerMembershipId !== undefined &&
      (actor.platformRole !== "admin" || normalized.assignment !== "all"));
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
  const listRead = listInvalid
    ? Promise.resolve({ page: null, unavailable: false as const })
    : listPlatformSalesLeads(actor, {
        assignment: normalized.assignment,
        connection: normalized.connection,
        cursor: normalized.cursor,
        due: normalized.due,
        ownerMembershipId: normalized.ownerMembershipId,
        pageSize: 50,
        query: normalized.query,
        stage: normalized.stage,
      })
        .then((page) => ({ page, unavailable: false as const }))
        .catch((error: unknown) => {
          if (error instanceof PlatformSalesWorkflowRepositoryError) {
            return { page: null, unavailable: true as const };
          }
          throw error;
        });
  const ownerRead = listPlatformSalesOwnerOptions(actor, { pageSize: 50 })
    .then((page) => ({ page, unavailable: false as const }))
    .catch((error: unknown) => {
      if (error instanceof PlatformSalesWorkflowRepositoryError) {
        return { page: null, unavailable: true as const };
      }
      throw error;
    });
  const [listResult, intakeResult, ownerResult] = await Promise.all([
    listRead,
    intakeRead,
    ownerRead,
  ]);
  const actorRole = actor.platformRole === "admin" ? "admin" : "sales";
  const ownerOptions =
    actorRole === "sales"
      ? (ownerResult.page?.rows ?? []).filter(
          (option) => option.membershipId === actor.membershipId,
        )
      : ownerResult.page?.rows ?? [];

  return (
    <CanonicalSalesPresentation
      actorRole={actorRole}
      locale={locale}
      page={listResult.page}
      params={normalized}
      listInvalid={listInvalid}
      listUnavailable={listResult.unavailable}
      ownerOptions={ownerOptions}
      ownerOptionsUnavailable={ownerResult.unavailable}
      ownerOptionsTruncated={ownerResult.page?.hasNext ?? false}
      intakePage={intakeResult.page}
      intakeUnavailable={intakeResult.unavailable}
      intakeInvalid={normalized.intakeInvalid}
    />
  );
}

type NormalizedParams = Readonly<{
  assignment: PlatformSalesAssignmentFilter;
  connection: PlatformSalesConnectionFilter;
  cursor: PlatformSalesWorkflowCursor | null;
  due: PlatformSalesDueFilter;
  intakeCursor: PlatformSalesIntakeCursor | null;
  intakeInvalid: boolean;
  intakeQuery?: string;
  intakeState?: PlatformSalesIntakeState;
  listInvalid: boolean;
  ownerMembershipId?: string;
  query?: string;
  stage?: PlatformSalesStage;
}>;

function normalizeSearchParams(params: SearchParams): NormalizedParams {
  const intake = normalizeIntakeSearchParams(params);
  try {
    assertOnlySearchKeys(params, [
      "assignment",
      "before_at",
      "before_id",
      "connection",
      "due",
      "intake_before_at",
      "intake_before_id",
      "intake_q",
      "intake_state",
      "owner",
      "q",
      "stage",
    ]);
    const beforeAt = singleValue(params.before_at);
    const beforeId = singleValue(params.before_id);
    const assignment = trimmed(singleValue(params.assignment)) ?? "all";
    const connection = trimmed(singleValue(params.connection)) ?? "all";
    const due = trimmed(singleValue(params.due)) ?? "all";
    const owner = trimmed(singleValue(params.owner));
    const query = trimmed(singleValue(params.q));
    const stage = trimmed(singleValue(params.stage));
    const ownerMembershipId = owner ? parsePlatformSalesUuid(owner) : undefined;
    if (
      (query && query.length > 120) ||
      !PLATFORM_SALES_ASSIGNMENT_FILTERS.includes(
        assignment as PlatformSalesAssignmentFilter,
      ) ||
      !PLATFORM_SALES_CONNECTION_FILTERS.includes(
        connection as PlatformSalesConnectionFilter,
      ) ||
      !PLATFORM_SALES_DUE_FILTERS.includes(due as PlatformSalesDueFilter) ||
      (stage && !PLATFORM_SALES_STAGES.includes(stage as PlatformSalesStage)) ||
      (owner && ownerMembershipId === null) ||
      (ownerMembershipId !== undefined && assignment !== "all")
    ) {
      throw new PlatformSalesWorkflowRepositoryError("invalid");
    }
    return {
      assignment: assignment as PlatformSalesAssignmentFilter,
      connection: connection as PlatformSalesConnectionFilter,
      cursor: parsePlatformSalesWorkflowCursor(beforeAt, beforeId),
      due: due as PlatformSalesDueFilter,
      ...intake,
      listInvalid: false,
      ownerMembershipId: ownerMembershipId ?? undefined,
      query,
      stage: stage as PlatformSalesStage | undefined,
    };
  } catch (error) {
    if (error instanceof PlatformSalesWorkflowRepositoryError) {
      return {
        assignment: "all",
        connection: "all",
        cursor: null,
        due: "all",
        ...intake,
        listInvalid: true,
      };
    }
    throw error;
  }
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
    throw new PlatformSalesWorkflowRepositoryError("invalid");
  }
}

function singleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    throw new PlatformSalesWorkflowRepositoryError("invalid");
  }
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
  actorRole,
  locale,
  page,
  params,
  listInvalid,
  listUnavailable,
  ownerOptions,
  ownerOptionsUnavailable,
  ownerOptionsTruncated,
  intakePage,
  intakeUnavailable,
  intakeInvalid,
}: Readonly<{
  actorRole: "admin" | "sales";
  locale: Locale;
  page: PlatformSalesLeadPage | null;
  params: NormalizedParams;
  listInvalid: boolean;
  listUnavailable: boolean;
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsUnavailable: boolean;
  ownerOptionsTruncated: boolean;
  intakePage: PlatformSalesIntakePage | null;
  intakeUnavailable: boolean;
  intakeInvalid: boolean;
}>) {
  const copy = COPY[locale];
  const workflow = SALES_WORKFLOW_COPY[locale];
  const shared = canonicalRecordCopy(locale);
  const rows = page?.rows ?? [];
  const duplicateCount = rows.filter(
    (lead) => lead.openDuplicateCandidateCount > 0,
  ).length;
  const unownedCount = rows.filter(
    (lead) => lead.currentOwnerMembershipId === null,
  ).length;
  const today = bishkekCalendarDate();

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

        <section className="space-y-4" aria-labelledby="sales-workflow-title">
          <div className="space-y-1">
            <h2 id="sales-workflow-title" className="text-[15px] font-semibold text-fg">
              {workflow.queueTitle}
            </h2>
            <p className="max-w-4xl text-[12.5px] leading-5 text-fg-3">
              {workflow.queueDescription}
            </p>
          </div>

          {page ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-[12px] text-fg-3">
              <Metric label={copy.found} value={rows.length} />
              <Metric label={copy.duplicates} value={duplicateCount} />
              <Metric label={copy.unowned} value={unownedCount} />
            </div>
          ) : null}

          <form
            action="/sales"
            method="get"
            className={`${filterBarCls} sm:grid-cols-2 xl:grid-cols-4`}
            aria-label={workflow.queueTitle}
          >
            <input
              className={inputCls}
              name="q"
              defaultValue={params.query}
              maxLength={120}
              placeholder={copy.search}
              aria-label={copy.search}
            />
            <select
              className={inputCls}
              name="connection"
              defaultValue={params.connection}
              aria-label={workflow.connection}
            >
              <option value="all">{workflow.allConnections}</option>
              <option value="connected">{workflow.connected}</option>
              <option value="unconnected">{workflow.unconnected}</option>
            </select>
            <select
              className={inputCls}
              name="stage"
              defaultValue={params.stage ?? ""}
              aria-label={copy.stage}
            >
              <option value="">{workflow.allStages}</option>
              {PLATFORM_SALES_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {SALES_STAGE_COPY[locale][stage]}
                </option>
              ))}
            </select>
            <select
              className={inputCls}
              name="assignment"
              defaultValue={params.assignment}
              aria-label={workflow.assignment}
            >
              <option value="all">{workflow.allAssignments}</option>
              <option value="mine">{workflow.mine}</option>
              <option value="unassigned">{workflow.unassigned}</option>
            </select>
            {actorRole === "admin" ? (
              <>
                <select
                  className={inputCls}
                  name="owner"
                  defaultValue={params.ownerMembershipId ?? ""}
                  aria-label={workflow.ownerFilter}
                  disabled={ownerOptionsUnavailable}
                >
                  <option value="">{workflow.allOwners}</option>
                  {ownerOptions.map((option) => (
                    <option key={option.membershipId} value={option.membershipId}>
                      {option.displayLabel}
                    </option>
                  ))}
                </select>
                {ownerOptionsUnavailable && params.ownerMembershipId ? (
                  <input type="hidden" name="owner" value={params.ownerMembershipId} />
                ) : null}
              </>
            ) : null}
            <select
              className={inputCls}
              name="due"
              defaultValue={params.due}
              aria-label={workflow.due}
            >
              <option value="all">{workflow.allDue}</option>
              <option value="scheduled">{workflow.scheduled}</option>
              <option value="unscheduled">{workflow.unscheduled}</option>
              <option value="due_today">{workflow.dueToday}</option>
              <option value="overdue">{workflow.overdueFilter}</option>
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

          {ownerOptionsUnavailable ? (
            <QueueNotice testId="sales-owner-options-unavailable">
              {workflow.ownerUnavailable}
            </QueueNotice>
          ) : ownerOptionsTruncated && actorRole === "admin" ? (
            <QueueNotice testId="sales-owner-options-truncated">
              {workflow.ownerTruncated}
            </QueueNotice>
          ) : null}

          <section aria-label={workflow.queueTitle} data-testid="canonical-lead-list">
            {listInvalid ? (
              <QueueNotice
                testId="sales-workflow-list-invalid"
                legacyTestId="canonical-records-unavailable"
              >
                {workflow.invalid}
              </QueueNotice>
            ) : listUnavailable || page === null ? (
              <QueueNotice
                testId="sales-workflow-list-unavailable"
                legacyTestId="canonical-records-unavailable"
              >
                {workflow.unavailable}
              </QueueNotice>
            ) : rows.length === 0 ? (
              <div className="border-y border-border" data-testid="canonical-leads-empty">
                <EmptyState text={emptyQueueCopy(locale, params)} />
              </div>
            ) : (
              <div className="max-w-full overflow-x-auto border-y border-border">
                <table className="w-full min-w-[1480px] text-left text-[12.5px]">
                  <thead className="border-b border-border bg-surface-2 text-[10.5px] uppercase tracking-[0.04em] text-fg-3">
                    <tr>
                      <th className="px-4 py-3 font-semibold">{workflow.lead}</th>
                      <th className="px-3 py-3 font-semibold">{workflow.stageOwner}</th>
                      <th className="px-3 py-3 font-semibold">{workflow.nextAction}</th>
                      <th className="px-3 py-3 font-semibold">{workflow.connectionContext}</th>
                      <th className="px-3 py-3 font-semibold">{workflow.updatedVersion}</th>
                      <th className="px-4 py-3 font-semibold">{workflow.change}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((lead) => (
                      <SalesWorkflowRow
                        key={lead.leadId}
                        lead={lead}
                        locale={locale}
                        ownerOptions={ownerOptions}
                        ownerOptionsUnavailable={ownerOptionsUnavailable}
                        requestId={randomUUID()}
                        sharedUnavailable={shared.unavailable}
                        today={today}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {page ? (
            <nav
              className="flex items-center justify-between gap-3"
              aria-label={workflow.queueTitle}
            >
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
              {page.hasNext && page.nextCursor ? (
                <Link
                  href={salesHref(params, { canonicalCursor: page.nextCursor })}
                  className={btnGhostCls}
                  rel="next"
                >
                  {copy.next} →
                </Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function SalesWorkflowRow({
  lead,
  locale,
  ownerOptions,
  ownerOptionsUnavailable,
  requestId,
  sharedUnavailable,
  today,
}: Readonly<{
  lead: PlatformSalesLeadWorkflow;
  locale: Locale;
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsUnavailable: boolean;
  requestId: string;
  sharedUnavailable: string;
  today: string;
}>) {
  const copy = COPY[locale];
  const workflow = SALES_WORKFLOW_COPY[locale];
  const isOverdue = lead.nextActionDueDate !== null && lead.nextActionDueDate < today;
  const isDueToday = lead.nextActionDueDate === today;

  return (
    <tr
      className="align-top transition-colors hover:bg-surface-2"
      data-testid="canonical-lead-row"
      data-lead-id={lead.leadId}
      data-workflow-version={lead.workflowVersion}
    >
      <td className="px-4 py-3">
        <Link
          href={`/sales/${lead.leadId}`}
          className="font-semibold text-fg hover:text-accent"
          aria-label={`${lead.clientDisplayName ?? copy.noClient} · ${lead.leadId}`}
        >
          {lead.clientDisplayName ?? copy.noClient}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <CanonicalUuid value={lead.leadId} />
          <DuplicateStatus
            count={lead.openDuplicateCandidateCount}
            locale={locale}
          />
        </div>
        <div className="mt-1 text-[11.5px] text-fg-3">
          {[lead.clientEmail, lead.clientPhone].filter(Boolean).join(" · ") ||
            sharedUnavailable}
        </div>
        <div className="mt-1 text-[11px] text-fg-3">
          {humanizeCanonicalKey(lead.sourceKey)}
        </div>
      </td>
      <td className="px-3 py-3">
        <div data-testid="canonical-lead-stage" data-stage-key={lead.stage}>
          <CanonicalKeyBadge value={SALES_STAGE_COPY[locale][lead.stage]} tone="accent" />
        </div>
        <div className="mt-2" data-testid="canonical-lead-owner">
          <div className="font-medium text-fg-2">
            {lead.currentOwnerDisplayName ?? copy.notAssigned}
          </div>
          {lead.currentOwnerMembershipId ? (
            <div className="mt-1">
              <CanonicalUuid value={lead.currentOwnerMembershipId} />
            </div>
          ) : null}
        </div>
      </td>
      <td className="max-w-[280px] px-3 py-3" data-testid="sales-lead-next-action">
        <div className="font-medium leading-5 text-fg-2">
          {lead.nextActionText ?? workflow.noAction}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]">
          {lead.nextActionDueDate ? (
            <time dateTime={lead.nextActionDueDate} className="font-mono text-fg-3">
              {lead.nextActionDueDate}
            </time>
          ) : (
            <span className="text-fg-3">{workflow.noDueDate}</span>
          )}
          {isOverdue ? (
            <span className="rounded-full bg-danger-weak px-2 py-0.5 font-semibold text-danger">
              {workflow.overdue}
            </span>
          ) : isDueToday ? (
            <span className="rounded-full bg-warn-weak px-2 py-0.5 font-semibold text-warn">
              {workflow.today}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-3" data-testid="sales-lead-connection">
        <div className={lead.isConnected ? "font-semibold text-ok" : "font-semibold text-fg-2"}>
          {lead.isConnected ? workflow.connectedShort : workflow.unconnectedShort}
        </div>
        <p className="mt-1 max-w-[230px] text-[11px] leading-4 text-fg-3">
          {lead.isConnected
            ? workflow.connectionHelpConnected
            : workflow.connectionHelpUnconnected}
        </p>
        <div className="mt-2 text-[11.5px] text-fg-3">
          <div>{lead.linkedConversationCount} {workflow.conversations}</div>
          <div className="mt-1">
            {lead.linkedStudentCaseCount} {workflow.studentCases}
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-[11px] text-fg-3">
        <div className="font-mono">
          {formatCanonicalTimestamp(lead.updatedAt, locale)}
        </div>
        <div className="mt-2">
          {workflow.version}: <strong className="font-mono text-fg">{lead.workflowVersion}</strong>
        </div>
      </td>
      <td className="w-[390px] px-4 py-3">
        <SalesLeadWorkflowForm
          compact
          lead={lead}
          locale={workflowFormLocale(locale)}
          ownerOptions={ownerOptions}
          ownerOptionsUnavailable={ownerOptionsUnavailable}
          requestId={requestId}
        />
      </td>
    </tr>
  );
}

function QueueNotice({
  children,
  legacyTestId,
  testId,
}: Readonly<{
  children: React.ReactNode;
  legacyTestId?: string;
  testId: string;
}>) {
  return (
    <div
      className="border-l-[3px] border-warn bg-warn-weak px-4 py-3 text-[12.5px] leading-5 text-fg-2"
      data-testid={testId}
    >
      {legacyTestId ? <span data-testid={legacyTestId}>{children}</span> : children}
    </div>
  );
}

function emptyQueueCopy(locale: Locale, params: NormalizedParams) {
  const copy = SALES_WORKFLOW_COPY[locale];
  if (params.connection === "connected") return copy.emptyConnected;
  if (params.connection === "unconnected") return copy.emptyUnconnected;
  if (params.due === "overdue") return copy.emptyOverdue;
  if (params.assignment === "unassigned") return copy.emptyUnassigned;
  if (
    params.query ||
    params.stage ||
    params.ownerMembershipId ||
    params.assignment !== "all" ||
    params.due !== "all"
  ) {
    return copy.emptyFiltered;
  }
  return copy.empty;
}

function workflowFormLocale(locale: Locale): "ru" | "en" {
  return locale === "en" ? "en" : "ru";
}

function bishkekCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bishkek",
    year: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
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
      {params.connection !== "all" ? (
        <input type="hidden" name="connection" value={params.connection} />
      ) : null}
      {params.assignment !== "all" ? (
        <input type="hidden" name="assignment" value={params.assignment} />
      ) : null}
      {params.ownerMembershipId ? (
        <input type="hidden" name="owner" value={params.ownerMembershipId} />
      ) : null}
      {params.due !== "all" ? (
        <input type="hidden" name="due" value={params.due} />
      ) : null}
      {params.cursor ? (
        <>
          <input type="hidden" name="before_at" value={params.cursor.updatedAt} />
          <input type="hidden" name="before_id" value={params.cursor.leadId} />
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
    canonicalCursor?: PlatformSalesWorkflowCursor | null;
    intakeCursor?: PlatformSalesIntakeCursor | null;
    includeCanonical?: boolean;
    includeIntake?: boolean;
  }> = {},
) {
  const query = new URLSearchParams();
  if (options.includeCanonical !== false) {
    if (params.query) query.set("q", params.query);
    if (params.stage) query.set("stage", params.stage);
    if (params.connection !== "all") query.set("connection", params.connection);
    if (params.assignment !== "all") query.set("assignment", params.assignment);
    if (params.ownerMembershipId) query.set("owner", params.ownerMembershipId);
    if (params.due !== "all") query.set("due", params.due);
    const canonicalCursor = Object.hasOwn(options, "canonicalCursor")
      ? options.canonicalCursor
      : params.cursor;
    if (canonicalCursor) {
      query.set("before_at", canonicalCursor.updatedAt);
      query.set("before_id", canonicalCursor.leadId);
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
