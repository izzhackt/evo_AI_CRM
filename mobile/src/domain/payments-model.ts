// Страница «Оплата»: слова, суммы и порядок показа. Порт PaymentsView.tsx (веб, #1452) поверх общего payment-rows.ts.
// Какие строки есть и что с ними можно сделать («Приложить чек» к остатку, «Заменить», чек к принятой оплате), решает общий
// модуль веба (`buildPaymentSchedule`), а не приложение: правило не копируется, поэтому оно не может разойтись с сайтом.
// Деньги в приложении не двигаются: оплата идёт вне приложения, студент прикладывает чек, засчитывает куратор.
import type { PaymentCenter, PaymentDue, PaymentEntryFileKind } from "@web/lib/portal/payment-center";
import { amountCopyValue, amountToPayMinor, nextUnpaidTranche, type HowToPayAmount } from "@web/lib/portal/how-to-pay";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";
import {
  buildPaymentSchedule,
  isGeneratedReceivedLabel,
  paymentGroupTitle,
  type PaymentGroup,
  type PaymentLine,
  type PaymentLineStatus,
} from "@web/lib/portal/payment-rows";

import type { PortalTone } from "@/domain/documents-model";
import { formatPortalDeadline, formatPortalMoney } from "@/domain/presentation";

type AdmissionStrings = PortalStrings<"admission">;

/** Минус суммы возврата: тот же знак, что в вебе (`−`, не дефис). */
const MINUS = "−";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Бишкек - UTC+6 круглый год (перехода на летнее время нет), поэтому день считается сдвигом, а не форматтером устройства. */
const BISHKEK_OFFSET_MS = 6 * 60 * 60 * 1000;
/** Самый поздний момент, который понимает `Date` (±8,64e15 мс): за ним `toISOString` бросает исключение. */
const MAX_DATE_MS = 8.64e15;

/** День по Бишкеку для момента `ms` (миллисекунды Unix): `YYYY-MM-DD`. 17:59:59.999 UTC - ещё тот же день, 18:00:00 UTC - уже следующий. */
export function bishkekDay(ms: number): string {
  return new Date(ms + BISHKEK_OFFSET_MS).toISOString().slice(0, 10);
}

/** День срока транша по Бишкеку. Нет срока, он не разбирается или не помещается в `Date` - `null`. */
function dueDay(dueAt: string | null): string | null {
  if (dueAt === null) return null;
  const ms = Date.parse(dueAt);
  return Number.isFinite(ms) && Math.abs(ms + BISHKEK_OFFSET_MS) <= MAX_DATE_MS ? bishkekDay(ms) : null;
}

export function paymentCategoryLabel(payment: Pick<PaymentDue, "category">, strings: AdmissionStrings): string | null {
  return strings[`payCategory.${payment.category}`] ?? null;
}

/** `YYYY-MM-DD` -> `дд.мм.гггг` (день по Бишкеку приходит готовым, часовой пояс не применяется). */
export function formatEntryDay(day: string): string {
  const [year, month, date] = day.split("-");
  return year && month && date ? `${date}.${month}.${year}` : day;
}

/**
 * Строка «Сумма к оплате» в «Как оплатить»: ближайший неоплаченный транш, остаток минус чеки на проверке
 * (веб: PaymentsView.tsx, #1476). Платить нечего - `null`, строки суммы нет.
 */
export function howToPayAmount(dues: readonly PaymentDue[]): HowToPayAmount | null {
  const next = nextUnpaidTranche(dues);
  if (!next) return null;
  const toPay = amountToPayMinor(next);
  return {
    display: formatPortalMoney(toPay, next.currency),
    dueOn: next.dueAt ? formatPortalDeadline(next.dueAt) : null,
    copyValue: amountCopyValue(toPay),
    overdue: next.overdue,
  };
}

// ---- строки таблицы «Платежи» ----------------------------------------------------------------------------------------

/** Файл строки: чек, который открывается через `case-files` (`receipt` - к оплате, `student_receipt` - чек студента). */
export type ReceiptFile = Readonly<{ fileKind: PaymentEntryFileKind; fileId: string; filename: string }>;

export type LineStatusView = Readonly<{ label: string; tone: PortalTone }>;

export type PaymentLineView = Readonly<{
  /** Строка общего модуля: ключ, суммы для отправки, `proofEventId`. */
  line: PaymentLine;
  /** «дд.мм.гггг» или «—». */
  dateText: string;
  /** Имя транша под датой, когда в услуге их несколько. */
  rowLabel: string | null;
  /** Сумма строки; возврат со знаком минус. */
  money: string;
  status: LineStatusView;
  /** «просрочено», если срок транша прошёл. */
  overdueLabel: string | null;
  rejectReason: string | null;
  file: ReceiptFile | null;
  /** «дата, сумма» строки: имя кнопки среди десятка одинаковых «Приложить чек». */
  context: string;
  /** Какую кнопку чека показать: «Приложить чек» к остатку или «Заменить» у отклонённого. */
  slot: "attach" | "replace" | null;
  /** Принятая оплата без файла: можно приложить файл как доказательство. */
  proofEventId: string | null;
}>;

const LINE_STATUS_TONE: Readonly<Record<PaymentLineStatus, PortalTone>> = {
  accepted: "ok",
  review: "info",
  rejected: "danger",
  refund: "neutral",
  missing: "neutral",
};

export function lineStatus(line: Pick<PaymentLine, "status">, strings: AdmissionStrings): LineStatusView {
  const label: Readonly<Record<PaymentLineStatus, string>> = {
    accepted: strings.receiptStatusAccepted,
    review: strings.receiptStatusReview,
    rejected: strings.receiptDeclined,
    refund: strings.receiptKindRefund,
    missing: strings.receiptNoReceipt,
  };
  return { label: label[line.status], tone: LINE_STATUS_TONE[line.status] };
}

/** Сумма строки: возврат как `−сумма`. */
export function lineMoney(line: Pick<PaymentLine, "amountMinor" | "currency" | "negative">): string {
  const text = formatPortalMoney(line.amountMinor, line.currency);
  return line.negative ? `${MINUS}${text}` : text;
}

/**
 * День строки для порядка и показа. Строка «Нет чека» стоит на сроке транша: его день считается здесь, по Бишкеку, а не берётся из
 * `line.onDate`, который общий модуль получает от форматтера устройства (`Intl`; что он выдаёт на телефоне, не проверено, а порядок
 * строк зависит от этого). Остальные строки - день записи с сервера (`YYYY-MM-DD`, строго разобран); странный формат не
 * показывается, берётся срок транша. Нет и его - `null`.
 */
export function lineDay(line: Pick<PaymentLine, "onDate" | "status">, due: Pick<PaymentDue, "dueAt"> | undefined): string | null {
  if (line.status !== "missing" && line.onDate !== null && ISO_DAY.test(line.onDate)) return line.onDate;
  return due ? dueDay(due.dueAt) : null;
}

/** День строки словами таблицы: «дд.мм.гггг» или «—» (веб: `shownDate`). */
export function lineDateText(line: Pick<PaymentLine, "onDate" | "status">, due: Pick<PaymentDue, "dueAt"> | undefined): string {
  const day = lineDay(line, due);
  return day === null ? "—" : formatEntryDay(day);
}

/** Порядок общего модуля (`byDate`): по дню, строки без дня в конце, при равном дне по ключу. День здесь свой (`lineDay`), не из `Intl`. */
function byDay(a: Readonly<{ day: string | null; line: PaymentLine }>, b: Readonly<{ day: string | null; line: PaymentLine }>): number {
  if (a.day === b.day) return a.line.key < b.line.key ? -1 : a.line.key > b.line.key ? 1 : 0;
  if (a.day === null) return 1;
  if (b.day === null) return -1;
  return a.day < b.day ? -1 : 1;
}

function orderedViews(lines: readonly PaymentLine[], dues: ReadonlyMap<string, PaymentDue>, strings: AdmissionStrings): PaymentLineView[] {
  return lines
    .map((line) => ({ line, day: lineDay(line, line.obligationId ? dues.get(line.obligationId) : undefined) }))
    .sort(byDay)
    .map(({ line, day }) => lineView(line, day, strings));
}

function lineView(line: PaymentLine, day: string | null, strings: AdmissionStrings): PaymentLineView {
  const dateText = day === null ? "—" : formatEntryDay(day);
  return {
    line,
    dateText,
    rowLabel: line.label,
    money: lineMoney(line),
    status: lineStatus(line, strings),
    overdueLabel: line.overdue ? strings["payStatus.overdue"] : null,
    rejectReason: line.rejectReason,
    file: line.fileId !== null && line.fileKind !== null && line.filename !== null ? { fileKind: line.fileKind, fileId: line.fileId, filename: line.filename } : null,
    context: `${dateText}, ${formatPortalMoney(line.amountMinor, line.currency)}`,
    slot: line.replace ? "replace" : line.attach ? "attach" : null,
    proofEventId: line.proofEventId,
  };
}

// ---- услуга: заголовок, суммы, полоса ---------------------------------------------------------------------------------

export type AmountTile = Readonly<{
  key: "toPay" | "paid" | "outstanding" | "refunded";
  label: string;
  value: string;
  /** «N на проверке» под «Оплачено». */
  aside: string | null;
}>;

export type ProgressBar = Readonly<{
  /** Доля зачтённого и доля чеков на проверке, в процентах ширины полосы. */
  paidPct: number;
  reviewPct: number;
  /** Целое число процентов для читалки: округляется вниз, чтобы «100» не звучало, пока остаток не закрыт. */
  valueNow: number;
  label: string;
}>;

export type ServiceView = Readonly<{
  key: string;
  title: string;
  /** Имя транша под заголовком: одно, настоящее и не повторяющее заголовок. */
  sharedName: string | null;
  tiles: readonly AmountTile[];
  bar: ProgressBar | null;
  nextActions: readonly string[];
  lines: readonly PaymentLineView[];
}>;

/**
 * Один и тот же текст для глаза: как `localeCompare(..., "ru", { sensitivity: "accent" })` на сайте (регистр не важен, «й» из одного знака
 * и «и» с краткой - одно и то же, неразрывный пробел - обычный). Сама проверка сайта берётся как есть, но что она скажет на телефоне, зависит
 * от `Intl` устройства, поэтому рядом стоит своя сверка на тех же различиях, без `Intl`: имя не должно повторять заголовок ни на одном телефоне.
 */
function sameText(a: string, b: string): boolean {
  const fold = (text: string) => text.normalize("NFC").replace(/[\u00A0\u2007\u202F]/gu, " ").toLocaleLowerCase("ru-RU");
  return fold(a) === fold(b) || a.localeCompare(b, "ru", { sensitivity: "accent" }) === 0;
}

/** Имя услуги под заголовком (веб: `sharedName`): не «Получено в USD», не повтор заголовка с точностью до регистра. */
export function sharedServiceName(title: string, labels: readonly string[]): string | null {
  const names = [...new Set(labels.filter((label) => !isGeneratedReceivedLabel(label)))];
  if (names.length !== 1) return null;
  return sameText(names[0], title) ? null : names[0];
}

function reviewAside(group: Pick<PaymentGroup, "reviewMinor" | "currency">, strings: AdmissionStrings): string | null {
  return group.reviewMinor > 0 ? formatPortalString(strings.receiptReviewAside, { amount: formatPortalMoney(group.reviewMinor, group.currency) }) : null;
}

/** Подпись полосы для читалки: «Оплачено X из Y» и, если есть, «N на проверке». */
export function progressLabel(group: Pick<PaymentGroup, "paidMinor" | "amountMinor" | "reviewMinor" | "currency">, strings: AdmissionStrings): string {
  const paid = formatPortalString(strings.receiptProgressLabel, { paid: formatPortalMoney(group.paidMinor, group.currency), total: formatPortalMoney(group.amountMinor, group.currency) });
  const aside = reviewAside(group, strings);
  return aside ? `${paid}. ${aside}` : paid;
}

/** Полоса: зачтённое (`сумма − остаток`) и чеки на проверке следом. Нет суммы - нет полосы. */
export function serviceBar(group: Pick<PaymentGroup, "paidMinor" | "amountMinor" | "outstandingMinor" | "reviewMinor" | "currency">, strings: AdmissionStrings): ProgressBar | null {
  if (group.amountMinor <= 0) return null;
  const credited = Math.max(0, group.amountMinor - group.outstandingMinor);
  const paidPct = Math.min(100, (credited / group.amountMinor) * 100);
  const reviewPct = Math.min(100 - paidPct, (group.reviewMinor / group.amountMinor) * 100);
  // Целыми числами: `0,29 * 100` в числах с плавающей точкой даёт 28,999..., и «29 %» превратилось бы в «28».
  const valueNow = Math.min(100, Math.floor((credited * 100) / group.amountMinor));
  return { paidPct, reviewPct, valueNow, label: progressLabel(group, strings) };
}

function serviceTiles(group: PaymentGroup, strings: AdmissionStrings): AmountTile[] {
  const tiles: AmountTile[] = [
    { key: "toPay", label: strings.toPayTerm, value: formatPortalMoney(group.amountMinor, group.currency), aside: null },
    { key: "paid", label: strings.paidTerm, value: formatPortalMoney(group.paidMinor, group.currency), aside: reviewAside(group, strings) },
    { key: "outstanding", label: strings.outstandingTerm, value: formatPortalMoney(group.outstandingMinor, group.currency), aside: null },
  ];
  if (group.refundedMinor > 0) tiles.push({ key: "refunded", label: strings.refundedTerm, value: formatPortalMoney(group.refundedMinor, group.currency), aside: null });
  return tiles;
}

// ---- вся страница ---------------------------------------------------------------------------------------------------------

export type PaymentsPageView = Readonly<{
  services: readonly ServiceView[];
  /** «Добавленные платежи»: чеки без платежа в графике (на проверке или отклонённые). */
  added: readonly PaymentLineView[];
  empty: boolean;
  /** Валюты платежей и чеков: подсказки в «Добавить платёж». */
  currencies: readonly string[];
  /** Валюта «Добавить платёж» по умолчанию: первая из `currencies`, иначе сом. */
  defaultCurrency: string;
}>;

/** Страница «Оплата» целиком (веб: `PaymentsView`). Правила кнопок чека - из `buildPaymentSchedule`. */
export function buildPaymentsPage(center: PaymentCenter, strings: AdmissionStrings): PaymentsPageView {
  const schedule = buildPaymentSchedule(center);
  const dues = new Map(center.dues.map((due) => [due.obligationId, due] as const));
  const services = schedule.groups.map((group): ServiceView => {
    const first = dues.get(group.obligationIds[0]);
    const title = paymentGroupTitle(first ? paymentCategoryLabel(first, strings) : null, group.labels);
    return {
      key: group.key,
      title,
      sharedName: sharedServiceName(title, group.labels),
      tiles: serviceTiles(group, strings),
      bar: serviceBar(group, strings),
      nextActions: group.nextActions,
      lines: orderedViews(group.lines, dues, strings),
    };
  });
  const added = orderedViews(schedule.added, dues, strings);
  const currencies = [...new Set([...center.dues.map((due) => due.currency), ...center.unassigned.map((entry) => entry.currency)])];
  return { services, added, empty: services.length === 0 && added.length === 0, currencies, defaultCurrency: currencies[0] ?? "KGS" };
}
