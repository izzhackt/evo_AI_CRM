/**
 * Дело студента «сначала работа» (решение владельца 26.09.2026,
 * docs/PLAN_CHANGES.md): чистая логика вида дела без React — строки
 * «Обзора» из уже прочитанных данных. По ней работают страница, статический
 * рендер и unit-тест. Новых чтений и команд здесь нет.
 */
import type { PlatformAdmissionsTask } from "../../../lib/platform-admissions-task-contract.ts";
import type { PlatformApplicationQueueRow } from "../../../lib/platform-application-contract.ts";
import type { CaseChatMessage, CaseChatPage } from "../../../lib/platform-case-chat-contract.ts";
import type { LeadSaleConditions } from "../../../lib/lead-sale-conditions-contract.ts";
import type { StudentCaseChecklistCounts, StudentCaseQueueRow } from "../../../lib/platform-student-case-queue-contract.ts";
import type { StudentApplication } from "../../../lib/student-application-contract.ts";
import { dayInOrganizationTimezone } from "../../../lib/platform-task-deadline.ts";
import { compareQueueTasks, taskIsOpen, type QueueTask } from "../../../lib/v3/task-queue.ts";
import { financeMoney } from "../../../lib/platform-finance-entry-contract.ts";
import { documentReviewDecision, journalEvent, studentProfileContactNote } from "../../../lib/v3/wording.ts";
import { formatQueueDay } from "../queue/due-bucket.ts";
import type { DocumentGroup } from "./document-types.ts";
import type { ProfileEvent } from "./types.ts";

/**
 * Строка дела из очереди 241 — этап, срок шага и версия для редактора шага.
 * `null` — строка не прочитана: этапа и редактора нет, шаг показывается из
 * самого дела без срока («нет чтения — нет числа»).
 */
export type CaseWorkRow = StudentCaseQueueRow | null;

/**
 * Открытые задачи дела в порядке «Задач»; «недоступно» — это не «задач нет».
 * «Нет доступа» — читатель «Ждут куратора» без права на само дело (281): задачи не читаются.
 */
export type CaseWorkTasks =
  | Readonly<{ kind: "ready"; tasks: readonly QueueTask[]; assignees: readonly Readonly<{ membershipId: string; displayName: string }>[] }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "forbidden" }>;

/** Последнее сообщение переписки по делу и её отметка. */
export type CaseWorkChatLine = Readonly<{
  authorName: string;
  /** Сообщение этого сотрудника: вместо имени — «Вы». */
  mine: boolean;
  /** Одна строка, до 140 знаков; вложение без текста — его подпись. */
  text: string;
  createdAt: string;
}>;

export type CaseWorkChat =
  | Readonly<{ kind: "ready"; awaitState: CaseChatPage["thread"]["awaitState"]; last: CaseWorkChatLine | null }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "unavailable" }>;

/**
 * Журнал дела для ленты Student 360 (Э4): первая страница того же чтения, что
 * у вкладки «История» (`staff_student_case_activity`, 132/241). `olderThan` —
 * граница страницы, если событий больше; «не читали» — лента не на первой
 * странице заметок или не «Обзор»; «недоступно» — чтение не удалось; «нет
 * доступа» — читатель «Ждут куратора» без права на само дело (281).
 */
export type CaseWorkActivity =
  | Readonly<{ kind: "ready"; events: readonly ProfileEvent[]; olderThan: string | null }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "not_read" }>
  | Readonly<{ kind: "forbidden" }>;

/** Всё, что вид дела читает сверх профиля (`readProfileTarget`). */
export type CaseWorkRead = Readonly<{
  row: CaseWorkRow;
  tasks: CaseWorkTasks;
  chat: CaseWorkChat;
  /** Журнал дела для ленты; у прежних вызовов без ленты — «не читали». */
  activity?: CaseWorkActivity;
  /** Admin выбирает куратора (флаг `needs_curator` чтения 182). */
  needsCurator: boolean;
  /**
   * Дело ждёт приёма передачи из продаж (флаг `awaiting_ack`). У дела без
   * передачи (добавлено поступлением, 281; одобренная анкета) принимать нечего:
   * «Приём дела» в «Сведениях» не показывается. Нет строки очереди — неизвестно.
   */
  awaitingAck?: boolean | null;
  /** Открытый запрос удаления аккаунта из портала (чтение 196, только Admin). */
  deletionRequested: boolean;
  /** Сегодня в Бишкеке. */
  today: string;
  /** Момент чтения: одинаковые сроки при рендере и гидрации. */
  nowIso: string;
}>;

/** Задача дела в строке «Задач» (`TaskQueueRow`): тот же вид, что даёт очередь задач по студентам. */
export function caseQueueTask(
  task: PlatformAdmissionsTask,
  studentDisplayName: string,
  caseState: "pending" | "active" | "closed",
): QueueTask {
  return Object.freeze({
    kind: "case", key: `case:${task.caseTaskId}`, id: task.caseTaskId, title: task.title, description: null,
    status: task.status, priority: task.priority, dueOn: task.dueOn, dueAt: task.dueAt, version: task.version,
    assigneeMembershipId: task.assigneeMembershipId, assigneeDisplayName: task.assigneeDisplayName,
    creatorMembershipId: null, studentCaseId: task.studentCaseId, studentDisplayName,
    caseState: caseState === "pending" ? null : caseState, studentVisible: task.studentVisible,
    fromChat: false, updatedAt: task.updatedAt,
  });
}

/** Открытые задачи дела по сроку, как в «Задачах»: просроченные первыми, без срока — в конце. */
export function caseOpenTasks(
  tasks: readonly PlatformAdmissionsTask[],
  studentDisplayName: string,
  caseState: "pending" | "active" | "closed",
): readonly QueueTask[] {
  return Object.freeze(tasks
    .filter((task) => taskIsOpen(task.status))
    .map((task) => caseQueueTask(task, studentDisplayName, caseState))
    .sort(compareQueueTasks("open")));
}

/** Сколько открытых задач «Обзор» показывает сразу; остальные — по «Показать ещё». */
export const CASE_TASKS_SHOWN = 6;

/**
 * Числа чек-листа из уже прочитанных документов дела — те же, что строка
 * очереди 241 считает по `document_slots` (удалённые пункты не входят).
 */
export function caseChecklistCounts(groups: readonly DocumentGroup[]): StudentCaseChecklistCounts {
  const counts = { total: 0, submitted: 0, correctionRequired: 0, rejected: 0, approved: 0, missing: 0 };
  for (const group of groups) {
    if (group.kind !== "active") continue;
    for (const item of group.items) {
      counts.total += 1;
      if (item.status === "submitted") counts.submitted += 1;
      else if (item.status === "correction_required") counts.correctionRequired += 1;
      else if (item.status === "rejected") counts.rejected += 1;
      else if (item.status === "approved") counts.approved += 1;
      else counts.missing += 1;
    }
  }
  return Object.freeze(counts);
}

function oneLine(value: string, limit: number): string {
  const text = value.replace(/\s+/gu, " ").trim();
  return Array.from(text).length > limit ? `${Array.from(text).slice(0, limit - 1).join("")}…` : text;
}

/**
 * Строка «Переписки» из страницы чтения `case_chat_read_page_v1`: последнее
 * сообщение и отметка. Чтение страницы ничего не пишет — отметку о
 * прочтении ставит только открытая переписка.
 */
export function caseChatWork(page: CaseChatPage, actorMembershipId: string): CaseWorkChat {
  const last: CaseChatMessage | null = page.messages.reduce<CaseChatMessage | null>(
    (latest, message) => latest === null || BigInt(message.sequenceId) > BigInt(latest.sequenceId) ? message : latest,
    null,
  );
  return Object.freeze({
    kind: "ready",
    awaitState: page.thread.awaitState,
    last: last === null ? null : Object.freeze({
      authorName: last.authorName,
      mine: last.authorMembershipId === actorMembershipId,
      text: oneLine(last.body || last.attachmentLabel || "Вложение", 140),
      createdAt: last.createdAt,
    }),
  });
}

const BISHKEK_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bishkek", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Момент в плотной строке: «22.09 14:30» по Бишкеку; год — только не текущий («03.01.27 09:00»). */
export function caseMomentLabel(iso: string, today: string): string {
  const moment = new Date(iso);
  return `${formatQueueDay(dayInOrganizationTimezone(moment), today)} ${BISHKEK_TIME.format(moment)}`;
}

/** Заявка «Обзора» одной строкой: вуз · программа, статус, основной вариант и дедлайн. */
export type CaseApplicationLine = Readonly<{
  id: string;
  title: string;
  status: string;
  primary: boolean;
  deadlineOn: string | null;
}>;

/** Основной вариант первым, остальные — в порядке чтения. */
export function caseApplicationLines(applications: readonly PlatformApplicationQueueRow[]): readonly CaseApplicationLine[] {
  return Object.freeze([...applications]
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))
    .map((application) => Object.freeze({
      id: application.universityApplicationId,
      title: application.programName ? `${application.institutionName} · ${application.programName}` : application.institutionName,
      status: application.status,
      primary: application.isPrimary,
      deadlineOn: application.universityDeadlineOn,
    })));
}

/**
 * Состояние «Доступа к порталу» одним словом. Сам доступ проверяет только
 * кнопка в «Настроить»: без анкеты состояние не прочитано, и строка это
 * называет, а не угадывает.
 */
export function casePortalStatus(application: StudentApplication | null): Readonly<{ text: string; tone: "muted" | "warn" | "ok" }> {
  if (application === null) return { text: "не проверен", tone: "muted" };
  if (application.status === "approved") return { text: "анкета одобрена", tone: "ok" };
  if (application.status === "rejected") return { text: "анкета отклонена", tone: "muted" };
  return { text: "анкета ждёт решения", tone: "warn" };
}

/**
 * Контакт «Сведений»: значение и пометка его состояния. `note` - null, когда
 * значение подтверждено или пришло от клиента лида (у него состояния нет).
 */
export type CaseContact = Readonly<{ value: string; note: string | null }>;
export type CaseContacts = Readonly<{ phone: CaseContact | null; email: CaseContact | null }>;

/**
 * Телефон и почта студента для «Сведений» (Э4). Первым идёт клиент лида, если
 * лид прочитан: это контакт, который ведёт продажа. Дело прямого студента
 * (добавлено поступлением или импортом) лида для чтения не имеет - лид у него
 * `converted`, лидовые чтения такие лиды не отдают, - поэтому контакт берётся
 * из полей анкеты `mobile_phone` и `student_email` с пометкой их состояния.
 * Анкета читается правом `profile.read.full`, как вкладка «Анкета»: нет чтения -
 * `fields` равно null и контактов нет, а не пустые поля.
 */
export function caseContacts(
  client: Readonly<{ phone: string | null; email: string | null }>,
  fields: Readonly<{ fields: readonly Readonly<{ key: string; value: string | null; state: string }>[] }> | null,
): CaseContacts {
  const pick = (own: string | null, key: string): CaseContact | null => {
    const ownValue = own?.trim();
    if (ownValue) return Object.freeze({ value: ownValue, note: null });
    const field = fields?.fields.find((item) => item.key === key);
    const value = field?.value?.trim();
    return field && value ? Object.freeze({ value, note: studentProfileContactNote(field.state) }) : null;
  };
  return Object.freeze({ phone: pick(client.phone, "mobile_phone"), email: pick(client.email, "student_email") });
}

/** Строка «Данных продажи»: подпись и значение; `day` - день `YYYY-MM-DD` для `<time>`. */
export type CaseSaleRow = Readonly<{ key: string; label: string; value: string; day?: string }>;
export type CaseSaleBlock = Readonly<{ key: "sale" | "wishes" | "education" | "conditions"; title: string; rows: readonly CaseSaleRow[] }>;

const BUDGET_PERIODS: Readonly<Record<string, string>> = { year: "в год", program: "за программу" };

/** «1 500,00 USD»; сумма без валюты не бывает (чтение держит пару), текст вместо суммы - как его ввели. */
function saleMoney(minor: number | null, currency: string | null, raw: string): string | null {
  if (minor !== null && currency !== null) return financeMoney(String(minor), currency);
  return raw.trim() || null;
}

/** `YYYY-MM-DD` -> `ДД.ММ.ГГГГ`: дата договора может быть из прошлых лет, год нужен. */
function saleDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}

/**
 * «Данные продажи» дела только чтением (290): те же блоки и подписи, что формы
 * карточки лида («Условия продажи», «Пожелания», «Образование», «Условия»), но
 * без полей: пустое не рисуется, блок без значений не рисуется. Деньги, которых
 * нет у читателя (ему закрыт финансовый раздел дела), сервер отдаёт пустыми -
 * строки тогда просто нет. Ключей базы на экране нет: период бюджета - слово.
 */
export function caseSaleBlocks(conditions: LeadSaleConditions): readonly CaseSaleBlock[] {
  const text = (key: string, label: string, value: string): CaseSaleRow | null => {
    const trimmed = value.trim();
    return trimmed ? { key, label, value: trimmed } : null;
  };
  const budget = saleMoney(conditions.conditionsBudgetMinor, conditions.conditionsBudgetCurrency, conditions.conditionsBudgetRaw);
  const period = conditions.conditionsBudgetPeriod ? BUDGET_PERIODS[conditions.conditionsBudgetPeriod] ?? null : null;
  const blocks: readonly Readonly<{ key: CaseSaleBlock["key"]; title: string; rows: readonly (CaseSaleRow | null)[] }>[] = [
    { key: "sale", title: "Условия продажи", rows: [
      text("service_label", "Услуга/пакет", conditions.serviceLabel),
      conditions.signingDate ? { key: "signing_date", label: "Дата продажи", value: saleDay(conditions.signingDate), day: conditions.signingDate } : null,
      text("service_cost", "Сумма", saleMoney(conditions.serviceCostMinor, conditions.serviceCostCurrency, conditions.serviceCostRaw) ?? ""),
      text("paid", "Оплачено", saleMoney(conditions.paidMinor, conditions.paidCurrency, conditions.paidRaw) ?? ""),
      text("payment_note", "Заметка об оплате", conditions.paymentNote),
    ] },
    { key: "wishes", title: "Пожелания", rows: [
      text("wishes_countries", "Страны", conditions.wishesCountries),
      text("wishes_study_fields", "Направления", conditions.wishesStudyFields),
      text("wishes_education_level", "Уровень образования", conditions.wishesEducationLevel),
      text("wishes_intake_year", "Год поступления", conditions.wishesIntakeYear),
      text("wishes_intake_season", "Сезон поступления", conditions.wishesIntakeSeason),
      text("wishes_universities", "Интересующие университеты", conditions.wishesUniversities),
    ] },
    { key: "education", title: "Образование", rows: [
      text("education_current", "Текущее образование", conditions.educationCurrent),
      text("education_grade", "Класс / курс", conditions.educationGrade),
      text("education_marks", "Оценки", conditions.educationMarks),
      text("education_english", "Уровень английского", conditions.educationEnglish),
      text("education_certificates", "Сертификаты", conditions.educationCertificates),
    ] },
    { key: "conditions", title: "Условия", rows: [
      text("conditions_budget", "Бюджет", [budget, budget ? period : null].filter(Boolean).join(" ")),
      text("conditions_scholarship", "Стипендия", conditions.conditionsScholarship),
      text("conditions_note", "Ограничения и пожелания", conditions.conditionsNote),
    ] },
  ];
  return blocks
    .map((block) => ({ key: block.key, title: block.title, rows: block.rows.filter((row): row is CaseSaleRow => row !== null) }))
    .filter((block) => block.rows.length > 0);
}

/**
 * Строка у названия свёрнутой группы: сумма и день продажи, если они есть,
 * иначе названия заполненных блоков.
 */
export function caseSaleSummary(blocks: readonly CaseSaleBlock[]): string {
  const rows = blocks.find((block) => block.key === "sale")?.rows ?? [];
  const lead = ["service_cost", "signing_date"].flatMap((key) => rows.find((row) => row.key === key)?.value ?? []);
  return lead.length > 0 ? lead.join(" · ") : blocks.map((block) => block.title.toLowerCase()).join(", ");
}

/** id группы «Доступ к порталу» — её раскрывает «⋯ → Доступ к порталу» (тот же якорь, что у Lead 360). */
export const CASE_PORTAL_GROUP_ID = "portal-access";

/** id группы «Данные продажи» — `?panel=sales` и `#sale-conditions` раскрывают её. */
export const CASE_SALES_GROUP_ID = "sales-data";

/**
 * Главное действие дела по состоянию (Э4): «Принять дело», пока дело ждёт
 * ответа этого куратора (`pending` — `studentsHandoffPending`, просмотр роли не
 * отвечает). У этапов поступления своей команды нет — иначе действия нет.
 */
export function casePrimaryAction(input: Readonly<{ handoffPending: boolean; preview: boolean }>): "accept" | null {
  return input.handoffPending && !input.preview ? "accept" : null;
}

/** Сколько строк ленты видно сразу; остальные — по «Показать ещё» (страница около 1 600 px при 1440). */
export const CASE_FEED_SHOWN = 10;

export type CaseFeedNote = Readonly<{ body: string; authorDisplayName: string; createdAt: string }>;

/**
 * Строка ленты. `href` — куда ведёт событие (его объект): вкладка, раздел
 * этой страницы или переписка; null — отдельного объекта нет (само дело) или
 * его негде открыть.
 */
export type CaseFeedItem =
  | Readonly<{ kind: "note"; at: string; note: CaseFeedNote }>
  | Readonly<{ kind: "event"; at: string; key: string; text: string; href: string | null }>
  | Readonly<{ kind: "chat"; at: string; author: string; text: string; href: string }>
  | Readonly<{ kind: "older"; at: string }>;

/** Якорь шапки дела («Этап», «Что дальше», «Состояние») — цель событий шага и состояния в ленте. */
export const CASE_HEADER_ID = "case-header";
/** Якорь «Сведений» (куратор, «Передал», «Приём дела», направление) — цель событий куратора и передачи. */
export const CASE_FACTS_ID = "case-facts";

/** Адреса объектов ленты: вкладки дела (null — вкладки у сотрудника нет) и переписка. */
export type CaseFeedLinks = Readonly<{ route: string | null; money: string | null; documents: string | null; messages: string }>;

/** События дела, которые меняют шапку («Что дальше», «Состояние»). */
const HEADER_EVENTS: ReadonlySet<string> = new Set(["case.next.action.change", "case.lifecycle.change"]);
/** События дела, которые видно в «Сведениях»: куратор, замещение, передача, ответ, маршрут. */
const FACTS_EVENTS: ReadonlySet<string> = new Set([
  "case.curator.set", "case.coverage.start", "case.coverage.return", "case.handoff.acknowledge",
  "case.handoff.clarification", "lead.admissions.handoff.completed", "case.route.change",
]);

/**
 * Куда ведёт событие журнала (Э4, review 27.09): заявки — «Вузы и программы»,
 * деньги — «Договор и оплата» (ссылки вкладок с возвратом), переписка — адрес,
 * который строит само чтение журнала (`href`), шаг и состояние — шапка,
 * куратор и передача — «Сведения». «Дело заведено» — само дело, визовых
 * карточек больше нет (S4): у них ссылки нет.
 */
export function caseEventLink(event: Pick<ProfileEvent, "transition" | "targetKind" | "href">, links: CaseFeedLinks): string | null {
  if (event.targetKind === "money") return links.money;
  if (event.targetKind === "conversation") return event.href ?? null;
  if (event.targetKind !== "overview") return null;
  if (event.transition.startsWith("application.")) return links.route;
  if (HEADER_EVENTS.has(event.transition)) return `#${CASE_HEADER_ID}`;
  if (FACTS_EVENTS.has(event.transition)) return `#${CASE_FACTS_ID}`;
  return null;
}

/**
 * События журнала, которые идут в ленту: само дело, заявки, деньги (их
 * отдаёт только тот, кому их читает сервер) и привязка переписки. Документы
 * без времени (132) и задачи в ленту не идут — у задач свои строки, всё —
 * во вкладке «История»; записи отдельных сообщений WhatsApp — тоже.
 */
const FEED_TARGETS: ReadonlySet<string> = new Set(["overview", "money", "conversation"]);
const FEED_SKIPPED: ReadonlySet<string> = new Set(["communication.message.record"]);

const validMoment = (value: string | null | undefined): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

/**
 * Решения проверки документов из уже прочитанных документов дела: последнее
 * решение по каждому пункту чек-листа с его временем. Загрузок здесь нет:
 * время и автор загрузки сотрудникам не показываются.
 */
export function caseDocumentReviews(groups: readonly DocumentGroup[]): readonly Readonly<{ key: string; at: string; text: string }>[] {
  const reviews: Readonly<{ key: string; at: string; text: string }>[] = [];
  for (const group of groups) {
    if (group.kind !== "active") continue;
    for (const item of group.items) {
      if (item.presence !== "present" || item.latestReview === null) continue;
      const decision = documentReviewDecision(item.latestReview.decision);
      if (!decision || !validMoment(item.latestReview.reviewedAt)) continue;
      reviews.push(Object.freeze({ key: `review:${item.id}`, at: item.latestReview.reviewedAt, text: `${item.name} — ${decision}` }));
    }
  }
  return Object.freeze(reviews);
}

/**
 * Лента Student 360 (Э4): заметки и события — новые сверху, всё из уже
 * прочитанного. События стоят только на первой странице заметок (на более
 * ранних страницах лента — только заметки, иначе события повторялись бы).
 * Событий журнала больше страницы — на месте среза строка «Более ранние
 * события журнала дела — во вкладке «История»». Журнал не прочитан — события
 * из других чтений остаются, `eventsUnavailable` называет пробел.
 */
export function caseFeed(input: Readonly<{
  notes: readonly CaseFeedNote[];
  firstPage: boolean;
  activity: CaseWorkActivity;
  /** Документы дела; null — нет права их читать (событий документов нет). */
  documents: readonly DocumentGroup[] | null;
  /**
   * Текущий ответ на передачу: отказа нет в журнале 132, он берётся отсюда. После отказа 182 чтение
   * 130 ответа не отдаёт (назначение снято), так что сейчас строки отказа не бывает; она не выдумывается.
   */
  handoffAnswer: Readonly<{ decision: string; createdAt: string }> | null;
  chat: CaseWorkChat;
  /** Адреса объектов событий; вкладки — те же ссылки с возвратом, что у «Сведений». */
  links: CaseFeedLinks;
  /**
   * Уже прочитанные заявки дела: событие заявки журнала несёт её id
   * (`targetId`) — по нему строка называет вуз и программу. Нет в списке —
   * только слова события.
   */
  applications: readonly CaseApplicationLine[];
}>): Readonly<{ items: readonly CaseFeedItem[]; eventsUnavailable: boolean }> {
  const items: CaseFeedItem[] = input.notes.map((note) => ({ kind: "note", at: note.createdAt, note }));
  const applicationTitle = new Map(input.applications.map((application) => [application.id, application.title]));
  if (input.firstPage) {
    if (input.activity.kind === "ready") {
      for (const event of input.activity.events) {
        const text = journalEvent(event.transition);
        if (!text || !FEED_TARGETS.has(event.targetKind ?? "") || FEED_SKIPPED.has(event.transition) || !validMoment(event.occurredAt)) continue;
        const title = event.transition.startsWith("application.") && event.targetId ? applicationTitle.get(event.targetId) : undefined;
        items.push({ kind: "event", at: event.occurredAt, key: `activity:${event.id}`, text: title ? `${text} · ${title}` : text,
          href: caseEventLink(event, input.links) });
      }
      if (validMoment(input.activity.olderThan)) items.push({ kind: "older", at: input.activity.olderThan });
    }
    for (const review of input.documents ? caseDocumentReviews(input.documents) : []) {
      items.push({ kind: "event", ...review, href: input.links.documents });
    }
    if (input.handoffAnswer?.decision === "declined" && validMoment(input.handoffAnswer.createdAt)) {
      items.push({ kind: "event", at: input.handoffAnswer.createdAt, key: "handoff:declined", text: "Куратор отклонил назначение", href: `#${CASE_FACTS_ID}` });
    }
    if (input.chat.kind === "ready" && input.chat.last && validMoment(input.chat.last.createdAt)) {
      const last = input.chat.last;
      items.push({ kind: "chat", at: last.createdAt, author: last.mine ? "Вы" : last.authorName, text: last.text, href: input.links.messages });
    }
  }
  // Стабильно: при равном времени заметка раньше события, порядок чтения сохраняется; срез журнала — последним.
  const rank = (item: CaseFeedItem) => item.kind === "older" ? 1 : 0;
  const sorted = items
    .map((item, index) => ({ item, index, time: Date.parse(item.at) }))
    .sort((a, b) => (b.time - a.time) || (rank(a.item) - rank(b.item)) || (a.index - b.index))
    .map(({ item }) => Object.freeze(item));
  return Object.freeze({ items: Object.freeze(sorted), eventsUnavailable: input.firstPage && input.activity.kind === "unavailable" });
}
