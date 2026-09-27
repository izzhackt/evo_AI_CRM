/**
 * Lead 360 как рабочая карточка (Э4, 27.09.2026): чистая логика без React —
 * главное действие по состоянию, строки свёрнутых групп правки, лента и
 * «последний контакт». По ней рисуют `LeadWorkParts`, статический рендер и
 * unit-тест. Всё — из уже прочитанных данных: нет чтения — нет строки.
 */
import type { LeadSaleConditions } from "../../../lib/lead-sale-conditions-contract.ts";
import type { PlatformSalesStage } from "../../../lib/platform-sales-contract.ts";
import { dayInOrganizationTimezone } from "../../../lib/platform-task-deadline.ts";

/** id панели «Что дальше»: её открывают главное действие и «Изменить» в шапке (`popoverTarget`). */
export const LEAD_STEP_DRAWER_ID = "lead-next-step";

/** id группы «Доступ к порталу» — её раскрывает «⋯ → Доступ к порталу». */
export const LEAD_PORTAL_GROUP_ID = "portal-access";

/** Адрес формы «Добавить продажу» отчёта с уже выбранным лидом. */
export function leadSaleHref(leadId: string): string {
  return `/v3/main?${new URLSearchParams({ view: "sales", new: "true", lead: leadId }).toString()}`;
}

export type LeadPrimaryAction =
  | Readonly<{ kind: "step" }>
  | Readonly<{ kind: "sale"; href: string }>
  | Readonly<{ kind: "case"; href: string }>;

/**
 * Одно главное действие лида по состоянию:
 * - после передачи — «Открыть дело» (нейтральное: работа ушла в поступление),
 *   если дело открывается этому сотруднику; иначе действия нет;
 * - «Потенциальный клиент» и право записывать продажи — «Оформить продажу»;
 * - право вести лид — «Записать следующий шаг»;
 * - иначе — ничего (просмотр роли, только чтение).
 */
export function leadPrimaryAction(input: Readonly<{
  leadId: string;
  stage: PlatformSalesStage;
  handedOff: boolean;
  caseHref: string | null;
  canManageWorkflow: boolean;
  canRegisterSale: boolean;
}>): LeadPrimaryAction | null {
  if (input.handedOff) return input.caseHref ? { kind: "case", href: input.caseHref } : null;
  if (input.stage === "potential" && input.canRegisterSale) return { kind: "sale", href: leadSaleHref(input.leadId) };
  return input.canManageWorkflow ? { kind: "step" } : null;
}

/**
 * Какие формы группы «Договор и оплата» есть у этого сотрудника — та же
 * проверка, что у `HandoffGateForms`: подсказка интерфейса, решает сервер.
 */
export function handoffGateForms(gate: Readonly<{
  contractConfirmed: boolean;
  firstPaymentReceivedDate: string | null;
  canConfirmContract: boolean;
  canConfirmFirstPayment: boolean;
  canOverrideGate: boolean;
  normalHandoffAllowed: boolean;
}>, preview: boolean): Readonly<{ contract: boolean; payment: boolean; override: boolean }> {
  return {
    contract: !preview && !gate.contractConfirmed && gate.canConfirmContract,
    payment: !preview && gate.contractConfirmed && !gate.firstPaymentReceivedDate && gate.canConfirmFirstPayment,
    override: !preview && gate.canOverrideGate && !gate.normalHandoffAllowed,
  };
}

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

/** Сумма из минимальных единиц: «1 500 USD». */
export function leadMoney(minor: number | null, currency: string | null): string | null {
  return minor === null || !currency ? null : `${number.format(minor / 100)} ${currency}`;
}

const joined = (parts: readonly (string | null | undefined)[]): string | null => {
  const shown = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return shown.length > 0 ? shown.join(" · ") : null;
};

/** Строка свёрнутой группы: что уже заполнено; null — ничего. */
export function leadGroupSummaries(conditions: LeadSaleConditions): Readonly<{
  sale: string | null; wishes: string | null; education: string | null; conditions: string | null;
}> {
  const cost = leadMoney(conditions.serviceCostMinor, conditions.serviceCostCurrency);
  const paid = leadMoney(conditions.paidMinor, conditions.paidCurrency);
  const budget = leadMoney(conditions.conditionsBudgetMinor, conditions.conditionsBudgetCurrency);
  return {
    sale: joined([conditions.serviceLabel, cost, paid ? `оплачено ${paid}` : null]),
    wishes: joined([conditions.wishesCountries, conditions.wishesStudyFields, conditions.wishesIntakeYear]),
    education: joined([conditions.educationCurrent, conditions.educationEnglish]),
    conditions: joined([budget ? `бюджет ${budget}` : null, conditions.conditionsScholarship]),
  };
}

export type LeadFeedNote = Readonly<{ body: string; authorDisplayName: string; createdAt: string }>;
export type LeadFeedEvent = Readonly<{ key: string; at: string; text: string }>;
export type LeadFeedItem =
  | Readonly<{ kind: "note"; at: string; note: LeadFeedNote }>
  | Readonly<{ kind: "event"; at: string; event: LeadFeedEvent }>;

/**
 * Лента лида: заметки и события — новые сверху. События приходят только на
 * первую страницу заметок: на более ранних страницах лента — только заметки,
 * иначе события повторялись бы на каждой странице.
 */
export function leadFeed(
  notes: readonly LeadFeedNote[],
  events: readonly LeadFeedEvent[],
  firstPage: boolean,
): readonly LeadFeedItem[] {
  const items: LeadFeedItem[] = notes.map((note) => ({ kind: "note", at: note.createdAt, note }));
  if (firstPage) {
    for (const event of events) {
      if (Number.isFinite(Date.parse(event.at))) items.push({ kind: "event", at: event.at, event });
    }
  }
  // Стабильно: при равном времени заметка раньше события, порядок чтения сохраняется.
  return items
    .map((item, index) => ({ item, index, time: Date.parse(item.at) }))
    .sort((a, b) => (b.time - a.time) || (a.index - b.index))
    .map(({ item }) => item);
}

/**
 * «Последний контакт» — самое новое из прочитанного: заметка первой страницы
 * или обновление связанной переписки. Слово говорит, что это было: заметка —
 * не звонок, и мы не называем её звонком.
 */
export function leadLastContact(
  latestNote: string | null,
  conversations: readonly Readonly<{ updatedAt: string }>[],
): Readonly<{ at: string; what: "заметка" | "переписка" }> | null {
  const candidates: Readonly<{ at: string | null; what: "заметка" | "переписка" }>[] = [
    { at: latestNote, what: "заметка" },
    ...conversations.map((conversation) => ({ at: conversation.updatedAt, what: "переписка" as const })),
  ];
  let best: Readonly<{ at: string; what: "заметка" | "переписка" }> | null = null;
  for (const { at, what } of candidates) {
    if (!at || !Number.isFinite(Date.parse(at))) continue;
    if (best === null || Date.parse(at) > Date.parse(best.at)) best = { at, what };
  }
  return best;
}

const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" });

/** Метка времени ленты: «ДД.ММ ЧЧ:ММ», другой год — «ДД.ММ.ГГ ЧЧ:ММ» (время Бишкека). */
export function leadMoment(value: string, now: Date): string {
  const day = dayInOrganizationTimezone(new Date(value));
  const today = dayInOrganizationTimezone(now);
  const [year, month, date] = day.split("-");
  const dayText = year === today.slice(0, 4) ? `${date}.${month}` : `${date}.${month}.${year.slice(2)}`;
  return `${dayText} ${TIME.format(new Date(value))}`;
}

/** Срок следующего шага словом прежнего облика: «прошёл», «сегодня»; позже — без слова. */
export function leadDueState(dueDate: string | null, today: string): "overdue" | "today" | "later" | null {
  if (dueDate === null) return null;
  return dueDate < today ? "overdue" : dueDate === today ? "today" : "later";
}

/** Дата `YYYY-MM-DD` → «ДД.ММ», другой год — «ДД.ММ.ГГ». */
export function leadDay(day: string, today: string): string {
  const [year, month, date] = day.split("-");
  return year === today.slice(0, 4) ? `${date}.${month}` : `${date}.${month}.${year.slice(2)}`;
}
