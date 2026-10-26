import { dayDelta } from "../../components/v3/calendar/types.ts";
import { formatQueueDay } from "../../components/v3/queue/due-bucket.ts";
import { dayInOrganizationTimezone } from "../platform-task-deadline.ts";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "../platform-organization-time.ts";
import {
  requestTabCount,
  requestsHref,
  type RequestKind,
  type RequestRow,
  type RequestSelection,
  type RequestSourceFilter,
  type RequestsQueue,
  type RequestStatusFilter,
} from "../requests-queue-contract.ts";
import { leadDisplayName } from "./wording.ts";

/**
 * Представление «Заявок» (Э3, 27.09.2026): слова вкладок, источников и
 * разбора, «пришла» по Бишкеку и числа вкладок — только из чтения. Чистые
 * функции: их проверяют тесты и статический рендер.
 */
export const REQUEST_TAB_LABELS: Readonly<Record<RequestSourceFilter, string>> = {
  all: "Все", website: "Сайт", whatsapp: "WhatsApp", phone_call: "Звонки", platform_application: "Анкеты", portal_consultation: "Консультации",
};
/**
 * Имя строки: лид, созданный звонком с неизвестного номера, база называет «Звонок +996 ••• 00 02 01» —
 * здесь это «Номер …», потому что слово «Звонок» уже стоит в колонке источника. Правило одно с
 * «Сегодня» (`leadDisplayName`); имя, которое сотрудник уже поменял, остаётся как есть.
 */
export function requestDisplayName(row: Pick<RequestRow, "source" | "personName">): string {
  return leadDisplayName(row.source, row.personName);
}
export const REQUEST_STATUS_LABELS: Readonly<Record<RequestStatusFilter, string>> = { waiting: "Ждут разбора", all: "Включая разобранные" };
export const REQUEST_SOURCE_WORDS: Readonly<Record<RequestRow["source"], string>> = {
  website: "Сайт", whatsapp: "WhatsApp", phone_call: "Звонок", platform_application: "Анкета", portal_consultation: "Консультация",
};
const KIND_WORDS: Readonly<Record<RequestKind, string>> = {
  lead: "Заявки с сайта и WhatsApp", application: "Анкеты", consultation: "Консультации из кабинета",
};

const TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: PLATFORM_ORGANIZATION_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export type RequestReceived = Readonly<{ dateTime: string; text: string; word: string }>;

/**
 * Когда пришла: JetBrains Mono «ДД.ММ ЧЧ:ММ» по Бишкеку и слово «сегодня /
 * вчера / N дн назад» — тот же словарь, что у «Сегодня». Без цвета
 * срочности: SLA менеджеров нет (план Э3).
 */
export function requestReceived(occurredAt: string, now: Date): RequestReceived {
  const moment = new Date(occurredAt);
  const today = dayInOrganizationTimezone(now);
  const day = dayInOrganizationTimezone(moment);
  const ago = dayDelta(day, today);
  return Object.freeze({
    dateTime: occurredAt,
    text: `${formatQueueDay(day, today)} ${TIME.format(moment)}`,
    word: ago <= 0 ? "сегодня" : ago === 1 ? "вчера" : `${ago} дн назад`,
  });
}

/** Разбор строки: кто взял лид или в каком состоянии анкета и консультация. */
export type RequestTriage =
  | Readonly<{ kind: "owner"; name: string; mine: boolean }>
  | Readonly<{ kind: "take" }>
  | Readonly<{ kind: "untaken" }>
  | Readonly<{ kind: "handed" }>
  | Readonly<{ kind: "state"; word: string; by: string | null }>;

/**
 * «Взять себе» — только когда чтение сказало «можно взять» (сервер принял бы
 * именно эту команду) и интерфейс не в просмотре роли (`canAct`). Без права —
 * нет кнопки: лид без ответственного называется словом.
 */
export function requestTriage(row: RequestRow, options: Readonly<{ actorMembershipId: string; canAct: boolean }>): RequestTriage {
  if (row.kind === "lead") {
    if (row.owner) {
      const mine = row.owner.membershipId === options.actorMembershipId;
      return { kind: "owner", name: mine ? "Вы" : row.owner.name ?? "Назначен", mine };
    }
    if (row.handedOff) return { kind: "handed" };
    return row.take && options.canAct ? { kind: "take" } : { kind: "untaken" };
  }
  if (row.kind === "application") {
    const status = row.application.status;
    return { kind: "state", word: status === "pending" ? "ждёт решения" : status === "approved" ? "одобрена" : "отклонена", by: null };
  }
  const handled = row.consultation.status === "handled";
  return { kind: "state", word: handled ? "обработана" : "открыта", by: handled ? row.consultation.handledByName : null };
}

export type RequestTabView = Readonly<{ key: RequestSourceFilter; label: string; href: string; count: number | null; current: boolean }>;

/** Вид источника: три лидовых источника — «lead», анкеты и консультации — по одному. */
function kindOfSource(source: Exclude<RequestSourceFilter, "all">): RequestKind {
  return source === "platform_application" ? "application" : source === "portal_consultation" ? "consultation" : "lead";
}

/**
 * Вкладки «Все · Сайт · WhatsApp · Звонки · Анкеты · Консультации» с числами из
 * чтения при выбранном состоянии. Вкладки вида, который роль не читает, нет;
 * без чтения — вкладки без чисел. «Звонки» есть, только когда звонки входят в
 * чтение (телефония включена для сотрудников, T9); выбранная вкладка остаётся
 * всегда, чтобы устаревшая ссылка не вела на страницу без места.
 */
export function requestTabs(selection: RequestSelection, queue: RequestsQueue | null): readonly RequestTabView[] {
  const sources: readonly RequestSourceFilter[] = ["all", "website", "whatsapp", "phone_call", "platform_application", "portal_consultation"];
  return sources
    .filter((source) => source === "all" || source === selection.source
      || (source === "phone_call" ? queue !== null && queue.phoneCalls
        : !queue || queue.states[kindOfSource(source)] === "ready"))
    .map((source) => ({
      key: source,
      label: REQUEST_TAB_LABELS[source],
      href: requestsHref({ ...selection, source, cursor: null }),
      count: queue ? requestTabCount(queue.counts, source) : null,
      current: selection.source === source,
    }));
}

const KINDS: readonly RequestKind[] = ["lead", "application", "consultation"];
function kindsOfSource(source: RequestSourceFilter): readonly RequestKind[] {
  return source === "all" ? KINDS : [kindOfSource(source)];
}
/** «а», «а{last}б», «а, б{last}в». */
function listWords(words: readonly string[], last: string): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")}${last}${words.at(-1)}`;
}

/** Виды, закрытые роли, — строкой над очередью (не ошибка, а граница роли). */
export function requestClosedKinds(queue: RequestsQueue, source: RequestSourceFilter): readonly string[] {
  return kindsOfSource(source).filter((kind) => queue.states[kind] === "forbidden").map((kind) => KIND_WORDS[kind]);
}

/**
 * Строка над «Все», когда роль читает не все виды: какие закрыты и что список
 * и числа — без них. Иначе «Все 0» и пустая очередь выглядят как «анкет нет»,
 * хотя роль их просто не видит (ревью PR #1084). Всё открыто — строки нет.
 */
export function requestClosedLine(queue: RequestsQueue): string | null {
  const closed = requestClosedKinds(queue, "all");
  if (!closed.length) return null;
  const words = closed.map((word, index) => index ? word.charAt(0).toLowerCase() + word.slice(1) : word);
  return `${listWords(words, " и ")} вашей роли недоступны: список и числа ниже — без них.`;
}

const ARRIVALS: Readonly<Record<Exclude<RequestSourceFilter, "all">, string>> = {
  website: "заявки с формы сайта",
  whatsapp: "обращения из WhatsApp, когда он подключён",
  phone_call: "звонки с неизвестных номеров",
  platform_application: "анкеты поступающих с сайта",
  portal_consultation: "запросы консультаций из кабинета студента",
};
const KIND_ARRIVALS: Readonly<Record<RequestKind, string>> = {
  lead: "заявки с сайта и из WhatsApp", application: "анкеты поступающих", consultation: "запросы консультаций из кабинета студента",
};

/**
 * Выбрана вкладка «Звонки», а звонков в чтении нет (телефония для сотрудников
 * выключена): это не граница роли, а переключатель, поэтому страница говорит об
 * этом словом, а не «пусто». Роль, которая лиды не читает, получает ответ про
 * закрытый вид, как и раньше.
 */
export function requestCallsOff(queue: RequestsQueue, source: RequestSourceFilter): boolean {
  return source === "phone_call" && !queue.phoneCalls && queue.states.lead === "ready";
}

/**
 * Пустая очередь: что сюда приходит — только из видов, которые роль читает.
 * «Все» у Sales Manager без анкет не обещает анкет. Вид закрыт или закрыты
 * все — null: о закрытом говорят строка над «Все» и пустота своей вкладки.
 */
export function requestEmptyWhat(queue: RequestsQueue, source: RequestSourceFilter): string | null {
  const readable = kindsOfSource(source).filter((kind) => queue.states[kind] === "ready");
  if (!readable.length) return null;
  if (source !== "all") return `Сюда приходят ${ARRIVALS[source]}.`;
  const words = readable.map((kind) => kind === "lead" && queue.phoneCalls
    ? `${KIND_ARRIVALS.lead} и звонки с неизвестных номеров` : KIND_ARRIVALS[kind]);
  return `Сюда приходят ${listWords(words, words.length === 2 ? ", а также " : " и ")}.`;
}

/** «Последняя пришла 24.09 в 14:02 (3 дн назад)» — только из чтения. */
export function requestLatestLine(latestAt: string | null, now: Date): string | null {
  if (!latestAt) return null;
  const received = requestReceived(latestAt, now);
  const [day, time] = received.text.split(" ");
  return `Последняя пришла ${received.word === "сегодня" || received.word === "вчера" ? received.word : day} в ${time}${
    received.word !== "сегодня" && received.word !== "вчера" ? ` (${received.word})` : ""}.`;
}
