// Строки «Оплаты» для кабинета: транш без чека, оплата, чек на проверке, отклонённый чек, чек без платежа.
// Чистый модуль (веб и, при желании, приложение): без next, DOM и React.
// Принятие чека куратором создаёт оплату на выбранный платёж и не может превысить его остаток
// (`record_case_payment_v1`). Поэтому «Приложить чек» есть только у открытого остатка, а не у уже
// полностью зачтённой оплаты без файла: второй чек на тот же платёж куратор не смог бы принять.
import type { PaymentCenter, PaymentDue, PaymentEntry, PaymentEntryFileKind } from "./payment-center.ts";

const RECEIVED_IN_CURRENCY = /^Получено в [A-Z]{3}$/;

/** Подпись, которую зачисление в чужой валюте пишет вместо названия услуги (`Получено в USD`). */
export function isGeneratedReceivedLabel(label: string): boolean {
  return RECEIVED_IN_CURRENCY.test(label);
}

/** Заголовок услуги: «услуги EVO» → «Услуги EVO». Уже заглавная строка не меняется. */
export function serviceHeading(label: string): string {
  const chars = Array.from(label);
  if (chars.length === 0) return label;
  return chars[0].toLocaleUpperCase("ru-RU") + chars.slice(1).join("");
}

/**
 * Имя группы платежей. Категория («услуги EVO») важнее сгенерированного «Получено в USD».
 * Нет категории — первое настоящее имя, иначе исходная подпись.
 */
export function paymentGroupTitle(categoryLabel: string | null, labels: readonly string[]): string {
  if (categoryLabel && categoryLabel.trim() !== "") return serviceHeading(categoryLabel);
  const names = labels.filter((label) => !isGeneratedReceivedLabel(label));
  return names[0] ?? labels[0] ?? "";
}

export type PaymentLineStatus = "accepted" | "review" | "rejected" | "missing" | "refund";

export type PaymentLine = Readonly<{
  key: string;
  obligationId: string | null;
  /** День колонки «Дата», `YYYY-MM-DD`, либо null, если у транша нет срока. */
  onDate: string | null;
  amountMinor: number;
  currency: string;
  negative: boolean;
  filename: string | null;
  fileKind: PaymentEntryFileKind | null;
  fileId: string | null;
  status: PaymentLineStatus;
  rejectReason: string | null;
  /** Можно приложить первый чек к открытому остатку. */
  attach: boolean;
  /** Можно заменить отклонённый чек. Скрыто, пока по этому платежу уже есть чек на проверке. */
  replace: boolean;
  overdue: boolean;
  /** Имя транша, когда в одной услуге их несколько и это не «Получено в …». */
  label: string | null;
  /** Сумма, которая уйдёт с файлом. */
  submitAmountMinor: number;
  /** День оплаты для повторной отправки. null — форма подставит сегодняшний день по Бишкеку. */
  submitDate: string | null;
}>;

export type PaymentGroup = Readonly<{
  key: string;
  category: PaymentDue["category"];
  currency: string;
  obligationIds: readonly string[];
  labels: readonly string[];
  amountMinor: number;
  paidMinor: number;
  refundedMinor: number;
  outstandingMinor: number;
  /** Сумма чеков со статусом «на проверке» внутри группы. В «Оплачено» не входит. */
  reviewMinor: number;
  lines: readonly PaymentLine[];
  nextActions: readonly string[];
}>;

export type PaymentSchedule = Readonly<{
  groups: readonly PaymentGroup[];
  /** Чеки, которые студент отправил без платежа в графике. */
  added: readonly PaymentLine[];
}>;

function bishkekDay(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function lineFromEntry(due: PaymentDue, entry: PaymentEntry, replace: boolean): PaymentLine {
  const rejected = entry.kind === "receipt" && entry.status === "rejected";
  return {
    key: `${entry.kind}:${entry.entryId}`,
    obligationId: due.obligationId,
    onDate: entry.onDate,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    negative: entry.kind === "refund",
    filename: entry.filename,
    fileKind: entry.fileKind,
    fileId: entry.fileId,
    status: entry.kind === "refund" ? "refund" : entry.status,
    rejectReason: entry.rejectReason,
    attach: false,
    replace: rejected && replace,
    overdue: false,
    label: null,
    submitAmountMinor: entry.amountMinor,
    submitDate: entry.onDate,
  };
}

function missingLine(due: PaymentDue, canUpload: boolean, amountMinor: number): PaymentLine {
  return {
    key: `missing:${due.obligationId}`,
    obligationId: due.obligationId,
    onDate: bishkekDay(due.dueAt),
    amountMinor,
    currency: due.currency,
    negative: false,
    filename: null,
    fileKind: null,
    fileId: null,
    status: "missing",
    rejectReason: null,
    attach: canUpload && amountMinor > 0,
    replace: false,
    overdue: due.overdue,
    label: null,
    submitAmountMinor: amountMinor,
    submitDate: null,
  };
}

/** Сумма чеков, которые ещё не стали оплатой: на проверке или отклонены и ждут замены. */
function openReceiptMinor(due: PaymentDue): number {
  return due.entries.reduce((sum, entry) => (
    entry.kind === "receipt" && (entry.status === "review" || entry.status === "rejected")
      ? sum + entry.amountMinor
      : sum
  ), 0);
}

function linesForDue(due: PaymentDue, canUpload: boolean): PaymentLine[] {
  const hasReview = due.entries.some((entry) => entry.kind === "receipt" && entry.status === "review");
  const lines = due.entries.map((entry) => lineFromEntry(due, entry, canUpload && !hasReview));
  // Остаток, который не закрыт чеком на проверке и не ждёт замены отклонённого.
  // Чек на всю сумму остатка не даёт вторую строку; непокрытая часть остатка — даёт.
  const uncovered = Math.max(0, due.outstandingMinor - openReceiptMinor(due));
  if (uncovered > 0) lines.push(missingLine(due, canUpload, uncovered));
  return lines;
}

function looseLine(entry: PaymentEntry, canUpload: boolean): PaymentLine {
  const rejected = entry.status === "rejected";
  return {
    key: `loose:${entry.entryId}`,
    obligationId: null,
    onDate: entry.onDate,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    negative: false,
    filename: entry.filename,
    fileKind: entry.fileKind,
    fileId: entry.fileId,
    status: entry.status === "review" ? "review" : "rejected",
    rejectReason: entry.rejectReason,
    attach: false,
    replace: canUpload && rejected,
    overdue: false,
    label: null,
    submitAmountMinor: entry.amountMinor,
    submitDate: entry.onDate,
  };
}

function byDate(a: PaymentLine, b: PaymentLine): number {
  if (a.onDate === b.onDate) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  if (a.onDate === null) return 1;
  if (b.onDate === null) return -1;
  return a.onDate < b.onDate ? -1 : 1;
}

function reviewMinor(dues: readonly PaymentDue[]): number {
  return dues.reduce((sum, due) => sum + due.entries.reduce((inner, entry) => (
    entry.kind === "receipt" && entry.status === "review" ? inner + entry.amountMinor : inner
  ), 0), 0);
}

/** Группы по услуге и валюте, плюс чеки без платежа отдельным списком. */
export function buildPaymentSchedule(center: PaymentCenter): PaymentSchedule {
  const buckets = new Map<string, PaymentDue[]>();
  for (const due of center.dues) {
    const key = `${due.category}:${due.currency}`;
    const list = buckets.get(key);
    if (list) list.push(due);
    else buckets.set(key, [due]);
  }
  const groups = [...buckets.entries()].map(([key, dues]) => {
    const names = [...new Set(dues.map((due) => due.label).filter((label) => !isGeneratedReceivedLabel(label)))];
    const showLabel = names.length > 1;
    const lines = dues.flatMap((due) => linesForDue(due, center.canUpload).map((line) => (
      showLabel && !isGeneratedReceivedLabel(due.label) ? { ...line, label: due.label } : line
    ))).sort(byDate);
    const nextActions = [...new Set(dues.flatMap((due) => (due.nextAction && due.nextAction.trim() !== "" ? [due.nextAction] : [])))];
    return {
      key,
      category: dues[0].category,
      currency: dues[0].currency,
      obligationIds: dues.map((due) => due.obligationId),
      labels: dues.map((due) => due.label),
      amountMinor: dues.reduce((sum, due) => sum + due.amountMinor, 0),
      paidMinor: dues.reduce((sum, due) => sum + due.paidMinor, 0),
      refundedMinor: dues.reduce((sum, due) => sum + due.refundedMinor, 0),
      outstandingMinor: dues.reduce((sum, due) => sum + due.outstandingMinor, 0),
      reviewMinor: reviewMinor(dues),
      lines,
      nextActions,
    } satisfies PaymentGroup;
  });
  return {
    groups,
    added: center.unassigned.map((entry) => looseLine(entry, center.canUpload)).sort(byDate),
  };
}
