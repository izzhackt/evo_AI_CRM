/**
 * «Переписки» → «Кабинет студента» (Э5 плана редизайна 25.09.2026): чистая
 * логика очередей списка без React и без сервера. Числа сегментов, порядок
 * строк и «следующая переписка» собираются из уже прочитанных страниц того же
 * чтения `staff_case_chat_threads_v2` (234); новых чтений и команд здесь нет.
 *
 * Правило чисел — «нет чтения — нет числа»: число очереди есть, только если
 * её строки прочитаны целиком (чтение не обрезано на 200). Иначе числа нет, а
 * не «200» и не оценка.
 */
import type { CaseChatQueue, CaseChatThreadRow, CaseChatThreadsList } from "../../../lib/platform-case-chat-contract.ts";
import { dayInOrganizationTimezone } from "../../../lib/platform-task-deadline.ts";
import { dayDelta } from "../calendar/types.ts";

/** Очереди с числом: «Все» числа не показывает. */
export type CaseChatCountedQueue = Exclude<CaseChatQueue, "all">;

/** null — чтение очереди неполное или его нет: числа нет. */
export type CaseChatQueueCounts = Readonly<Record<CaseChatCountedQueue, number | null>>;

export type CaseChatQueueRead = Readonly<{
  /** Строки выбранной очереди в порядке показа. */
  list: CaseChatThreadsList;
  counts: CaseChatQueueCounts;
  /**
   * Дольше всех ждущая ответа переписка — только из полного чтения очереди
   * «Нужен ответ»; null — таких нет или чтение неполное (тогда и числа нет).
   */
  next: CaseChatThreadRow | null;
  /** Момент чтения на сервере: «ждёт N» одинаково при рендере и гидрации. */
  readAt: string;
}>;

/**
 * Прочитанные страницы: «Все» (без отбора по состоянию) и, если она
 * обрезана, отдельные чтения очередей с тем же поиском.
 */
export type CaseChatQueueReads = Readonly<{
  all: CaseChatThreadsList;
  needsReply?: CaseChatThreadsList | null;
  awaitingStudent?: CaseChatThreadsList | null;
}>;

export type CaseChatQueueReader = (queue: CaseChatQueue) => Promise<CaseChatThreadsList>;

function messageTime(row: CaseChatThreadRow): number | null {
  const time = row.lastMessageAt === null ? Number.NaN : Date.parse(row.lastMessageAt);
  return Number.isFinite(time) ? time : null;
}

/**
 * Дольше всех ждущие — первыми: по моменту последнего сообщения по
 * возрастанию, без сообщений — в конце, при равенстве — по id дела (зеркало
 * порядка чтения `last_message_at DESC NULLS LAST, id DESC`).
 */
export function oldestFirst(rows: readonly CaseChatThreadRow[]): readonly CaseChatThreadRow[] {
  return Object.freeze([...rows].sort((left, right) => {
    const a = messageTime(left);
    const b = messageTime(right);
    if (a !== b) {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    }
    return left.studentCaseId < right.studentCaseId ? -1 : left.studentCaseId > right.studentCaseId ? 1 : 0;
  }));
}

/**
 * Строки одной очереди. Полное «Все» содержит каждую переписку этого поиска,
 * поэтому очередь — её строки с тем же `await_state` (тот же предикат, что у
 * функции чтения: `t.await_state = p_await_state`). Обрезанное «Все» очередь
 * не заменяет — нужна её собственная страница.
 */
function queueRows(reads: CaseChatQueueReads, queue: CaseChatCountedQueue): CaseChatThreadsList | null {
  if (!reads.all.truncated) {
    return Object.freeze({ rows: Object.freeze(reads.all.rows.filter((row) => row.awaitState === queue)), truncated: false });
  }
  return (queue === "needs_reply" ? reads.needsReply : reads.awaitingStudent) ?? null;
}

const countOf = (list: CaseChatThreadsList | null): number | null => list && !list.truncated ? list.rows.length : null;

/**
 * Список, числа и следующая переписка из прочитанных страниц. «Нужен ответ»
 * при полном чтении идёт от дольше всех ждущих; обрезанная страница остаётся
 * в порядке чтения (самые старые в неё не попали, и «сначала старые» было бы
 * неправдой). «Ждём студента» и «Все» — в порядке чтения, от новых.
 */
export function composeCaseChatQueue(reads: CaseChatQueueReads, queue: CaseChatQueue, readAt: string): CaseChatQueueRead {
  const needsReply = queueRows(reads, "needs_reply");
  const awaitingStudent = queueRows(reads, "awaiting_student");
  const waiting = needsReply && !needsReply.truncated ? oldestFirst(needsReply.rows) : null;
  let list: CaseChatThreadsList;
  if (queue === "all") {
    list = reads.all;
  } else {
    const source = queue === "needs_reply" ? needsReply : awaitingStudent;
    if (!source) throw new Error("case_chat_queue_read_missing");
    list = queue === "needs_reply" && waiting ? Object.freeze({ rows: waiting, truncated: false }) : source;
  }
  return Object.freeze({
    list,
    counts: Object.freeze({ needs_reply: countOf(needsReply), awaiting_student: countOf(awaitingStudent) }),
    next: waiting?.[0] ?? null,
    readAt,
  });
}

/**
 * Чтения очереди: сначала «Все»; только если оно обрезано — обе очереди
 * отдельными чтениями с тем же поиском (их нужно и для чисел, и для списка).
 */
export async function readCaseChatQueueWith(
  read: CaseChatQueueReader,
  queue: CaseChatQueue,
  now: () => Date = () => new Date(),
): Promise<CaseChatQueueRead> {
  const all = await read("all");
  if (!all.truncated) return composeCaseChatQueue({ all }, queue, now().toISOString());
  const [needsReply, awaitingStudent] = await Promise.all([read("needs_reply"), read("awaiting_student")]);
  return composeCaseChatQueue({ all, needsReply, awaitingStudent }, queue, now().toISOString());
}

/**
 * Сколько ждёт ответа — от последнего сообщения до момента чтения, днями
 * Бишкека, как «Сегодня» и сроки: написали сегодня — «ждёт меньше часа» или
 * «ждёт 5 ч»; раньше — «ждёт 2 дн» (вчера — 1 дн). Нет времени — нет слова.
 */
export function caseChatWaitingWord(lastMessageAt: string | null, readAt: string): string | null {
  const since = new Date(lastMessageAt ?? Number.NaN);
  const now = new Date(readAt);
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(now.getTime())) return null;
  const days = dayDelta(dayInOrganizationTimezone(since), dayInOrganizationTimezone(now));
  if (days > 0) return `ждёт ${days} дн`;
  const hours = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 3_600_000));
  return hours < 1 ? "ждёт меньше часа" : `ждёт ${hours} ч`;
}

export type CaseChatNextLine =
  | Readonly<{ kind: "next"; row: CaseChatThreadRow; waiting: string | null }>
  | Readonly<{ kind: "all-answered" }>
  | Readonly<{ kind: "none" }>;

/**
 * Пустая правая часть: следующая переписка, ждущая ответа, или «Все ответы
 * даны». «Ждёт N» — только когда последнее сообщение не своё: своё последнее
 * сообщение при «Нужен ответ» (отметка вручную) — не ожидание студента.
 * «Все ответы даны» — только при полном чтении, нуле и без поиска: с поиском
 * ноль говорит только о найденных.
 */
export function caseChatNextLine(read: CaseChatQueueRead, membershipId: string, query: string): CaseChatNextLine {
  if (read.next) {
    const mine = read.next.lastMessageAuthorMembershipId === membershipId;
    return Object.freeze({ kind: "next", row: read.next, waiting: mine ? null : caseChatWaitingWord(read.next.lastMessageAt, read.readAt) });
  }
  if (read.counts.needs_reply === 0 && !query.trim()) return Object.freeze({ kind: "all-answered" });
  return Object.freeze({ kind: "none" });
}
