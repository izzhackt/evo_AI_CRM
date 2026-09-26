/**
 * Полоса «Передача» в Lead 360 (Э2 «Честные числа», решения владельца
 * 26.09.2026): чистая логика без React. По ней рисуют карточка, статический
 * рендер и unit-тест.
 *
 * Вместо красного «Договор и оплата: ожидает условий», который ничего не
 * запрещал, — пять доказательств передачи, каждое «есть с датой» или «нет»
 * из настоящего чтения (`staff_lead_handoff_strip_v1`): Договор · Первый
 * платёж · Запись в отчёте · Куратор · Принято. Условие передачи — только
 * доказательство, не запрет: до передачи полоса нейтральна. После передачи —
 * строка «Передано ДД.ММ · куратор · принято ДД.ММ» без предупреждения; если
 * передаче не хватает доказательства, это сказано словами в тоне
 * предупреждения.
 *
 * Продажа, сохранённая из отчёта в уже открытый кабинет (путь 208), ничего не
 * подтверждает в строке условий: её договор и оплата — сама запись отчёта
 * («по отчёту»), а не «—». Даты — один формат (DESIGN.md): ДД.ММ, другой год —
 * ДД.ММ.ГГ; в тексте дата — отдельный кусок, его рисуют JetBrains Mono.
 */
import type { LeadHandoffStrip } from "../../../lib/sales-numbers-contract.ts";
import { dayInOrganizationTimezone } from "../../../lib/platform-task-deadline.ts";
import { salesStage } from "../../../lib/v3/wording.ts";

export type HandoffStripItemKey = "contract" | "payment" | "report" | "curator" | "accepted";

/** Текст с датами: строка — слова, `{ date }` — дата ДД.ММ, её рисуют моноширинным. */
export type StripText = readonly (string | Readonly<{ date: string }>)[];

export type HandoffStripItem = Readonly<{
  key: HandoffStripItemKey;
  label: string;
  /**
   * done — доказательство есть; missing — нет; attention — есть, но с
   * оговоркой (словами); elsewhere — доказательство в отчёте продаж, который
   * эта роль не читает: ни галочки, ни прочерка наугад.
   */
  state: "done" | "missing" | "attention" | "elsewhere";
  /** Слова значения: имя куратора, «по отчёту», «в архиве»; null — только дата или «нет». */
  text: string | null;
  /** ДД.ММ (ДД.ММ.ГГ, если не этот год) по времени организации. */
  date: string | null;
}>;

export type HandoffStripWarning = Readonly<{
  text: StripText;
  /** Где это исправить: запись отчёта. null — ссылки нет. */
  href: string | null;
}>;

export type HandoffStripView = Readonly<{
  /** Название этапа, как у колонки доски; «Лид закрыт» для закрытого. */
  stageTitle: string;
  /** «Передано 18.09 · Куратор · принято 19.09»; null — передачи не было. */
  summary: StripText | null;
  items: readonly HandoffStripItem[];
  /** Чего не хватает переданному лиду — словами; до передачи пусто. */
  warnings: readonly HandoffStripWarning[];
}>;

const LABEL: Record<HandoffStripItemKey, string> = {
  contract: "Договор",
  payment: "Первый платёж",
  report: "Запись в отчёте",
  curator: "Куратор",
  accepted: "Принято",
};

/** Одно слово ожидания ответа куратора — и в строке, и в полосе. */
export const AWAITING_ANSWER = "ждёт ответа";

const amount = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

/** Дата `YYYY-MM-DD` → ДД.ММ; другой год — ДД.ММ.ГГ (DESIGN.md: «03.01.27»). */
export function stripDay(day: string, today: string): string {
  const [year, month, date] = day.split("-");
  return year === today.slice(0, 4) ? `${date}.${month}` : `${date}.${month}.${year.slice(2)}`;
}

/** Метка времени → день организации → ДД.ММ. */
export function stripMoment(value: string, today: string): string {
  return stripDay(dayInOrganizationTimezone(new Date(value)), today);
}

/** Текст полосы без разметки: для проверок и подписей. */
export function stripPlain(text: StripText): string {
  return text.map((part) => (typeof part === "string" ? part : part.date)).join("");
}

/** Запись отчёта в «Отчёте продаж»: `/v3/main?view=sales&year=…&month=…&record=…`. */
export function salesRecordHref(record: Readonly<{ id: string; reportMonth: string }>): string {
  const params = new URLSearchParams({
    view: "sales", year: record.reportMonth.slice(0, 4), month: String(Number(record.reportMonth.slice(5, 7))), record: record.id,
  });
  return `/v3/main?${params.toString()}`;
}

export function handoffStripView(
  strip: LeadHandoffStrip,
  options: Readonly<{ now: Date }>,
): HandoffStripView {
  const today = dayInOrganizationTimezone(options.now);
  const moment = (value: string | null) => (value === null ? null : stripMoment(value, today));
  const items: HandoffStripItem[] = [];
  const warnings: HandoffStripWarning[] = [];
  const handedOff = strip.handoff !== null;
  const record = strip.report.status === "available" ? strip.report.record : null;
  // Запись не в архиве — это продажа; её поля — доказательство договора и оплаты.
  const sale = record && !record.archived ? record : null;
  // Передачу доказала запись отчёта, а роль отчёт не читает: доказательство есть, но не здесь.
  const inUnreadReport = strip.report.status === "denied" && strip.handoff?.evidence === "sales_report";

  if (strip.contract.confirmed) {
    items.push({ key: "contract", label: LABEL.contract, state: "done", text: null, date: moment(strip.contract.confirmedAt) });
  } else if (sale && (sale.saleDate !== null || sale.hasContractNumber)) {
    items.push({ key: "contract", label: LABEL.contract, state: "done", text: "по отчёту",
      date: sale.saleDate === null ? null : stripDay(sale.saleDate, today) });
  } else if (inUnreadReport) {
    items.push({ key: "contract", label: LABEL.contract, state: "elsewhere", text: "в отчёте продаж", date: null });
  } else {
    items.push({ key: "contract", label: LABEL.contract, state: "missing", text: null, date: null });
  }

  if (strip.firstPayment.receivedDate) {
    items.push({ key: "payment", label: LABEL.payment, state: "done", text: null, date: stripDay(strip.firstPayment.receivedDate, today) });
  } else if (sale?.paid) {
    items.push({ key: "payment", label: LABEL.payment, state: "done",
      // Сумма и валюта не разрываются переносом.
      text: `по отчёту: оплачено ${amount.format(sale.paid.minor / 100)}\u00a0${sale.paid.currency}`, date: null });
  } else if (inUnreadReport) {
    items.push({ key: "payment", label: LABEL.payment, state: "elsewhere", text: "в отчёте продаж", date: null });
  } else {
    items.push({ key: "payment", label: LABEL.payment, state: "missing", text: null, date: null });
  }

  // Роль без чтения отчёта продаж не видит пункта вовсе — не «нет».
  if (strip.report.status === "available") {
    const href = record ? salesRecordHref(record) : null;
    if (record === null) {
      items.push({ key: "report", label: LABEL.report, state: "missing", text: null, date: null });
      if (handedOff) warnings.push({ text: ["Записи о продаже в отчёте нет."], href: null });
    } else if (record.archived) {
      items.push({ key: "report", label: LABEL.report, state: "attention", text: "в архиве", date: null });
      if (handedOff) warnings.push({ text: ["Запись о продаже в архиве и в продажи не входит."], href });
    } else if (record.saleDate === null) {
      items.push({ key: "report", label: LABEL.report, state: "attention", text: "без даты продажи", date: null });
      if (handedOff) warnings.push({ text: ["В записи отчёта нет даты продажи, поэтому в продажи она не входит."], href });
    } else {
      items.push({ key: "report", label: LABEL.report, state: "done", text: null, date: stripDay(record.saleDate, today) });
    }
  }

  const curator = strip.curator;
  const acceptance = strip.acceptance;
  const declined = acceptance?.decision === "declined";
  // Ответ записать нельзя (путь 208): «ждёт ответа» было бы шагом, который никто не сделает.
  const unrecordable = strip.handoff !== null && !strip.handoff.acceptanceRecordable;
  items.push(curator
    ? { key: "curator", label: LABEL.curator, state: "done", text: curator.displayName, date: moment(curator.assignedAt) }
    : { key: "curator", label: LABEL.curator, state: "missing", text: null, date: null });

  if (acceptance?.decision === "accepted") {
    items.push({ key: "accepted", label: LABEL.accepted, state: "done", text: null, date: moment(acceptance.at) });
  } else if (acceptance?.decision === "clarification_requested") {
    items.push({ key: "accepted", label: LABEL.accepted, state: "attention", text: "нужно уточнить", date: moment(acceptance.at) });
    warnings.push({ text: ["Куратор просит уточнить передачу."], href: null });
  } else if (declined) {
    items.push({ key: "accepted", label: LABEL.accepted, state: "attention", text: "отклонено", date: moment(acceptance.at) });
    warnings.push({ text: ["Куратор отклонил передачу ", { date: stripMoment(acceptance.at, today) },
      curator ? "." : ": дело ждёт нового куратора."], href: null });
  } else if (curator && unrecordable) {
    items.push({ key: "accepted", label: LABEL.accepted, state: "missing", text: "не отмечается", date: null });
    warnings.push({ text: ["Приём этой передачи в CRM не отмечается: продажа записана в уже открытый кабинет."], href: null });
  } else {
    items.push({ key: "accepted", label: LABEL.accepted, state: "missing", text: curator ? AWAITING_ANSWER : null, date: null });
  }
  if (handedOff && curator === null && !declined) {
    warnings.push({ text: ["Куратор не назначен: дело ждёт назначения."], href: null });
  }

  let summary: StripText | null = null;
  if (strip.handoff) {
    const parts: (string | Readonly<{ date: string }>)[] = ["Передано ", { date: stripMoment(strip.handoff.completedAt, today) }];
    if (curator) parts.push(` · ${curator.displayName}`);
    if (acceptance?.decision === "accepted") parts.push(" · принято ", { date: stripMoment(acceptance.at, today) });
    else if (acceptance?.decision === "clarification_requested") parts.push(" · нужно уточнить ", { date: stripMoment(acceptance.at, today) });
    else if (declined) parts.push(" · отклонено ", { date: stripMoment(acceptance.at, today) });
    else if (curator && !unrecordable) parts.push(` · ${AWAITING_ANSWER}`);
    summary = Object.freeze(parts);
  }

  return Object.freeze({
    stageTitle: strip.stage === "closed" ? "Лид закрыт" : salesStage(strip.stage) ?? "Этап неизвестен",
    summary,
    items: Object.freeze(items.map((item) => Object.freeze(item))),
    warnings: Object.freeze(warnings.map((warning) => Object.freeze(warning))),
  });
}

/**
 * Строка под полосой — ожидаемый первый платёж и ссылки-доказательства из
 * условий передачи. После получения платежа — «получен ДД.ММ», а не
 * «ожидается»: срок, который уже прошёл оплатой, не повторяется.
 */
export function handoffFootnote(
  gate: Readonly<{
    contractConfirmed: boolean;
    firstPaymentAmount: number | null;
    firstPaymentCurrency: string | null;
    firstPaymentDueDate: string | null;
    firstPaymentReceivedDate: string | null;
    contractEvidenceReference: string | null;
    firstPaymentEvidenceReference: string | null;
  }>,
  options: Readonly<{ now: Date }>,
): StripText | null {
  const today = dayInOrganizationTimezone(options.now);
  const lines: StripText[] = [];
  if (gate.contractConfirmed && gate.firstPaymentAmount !== null) {
    const money = `Первый платёж ${amount.format(gate.firstPaymentAmount)}${gate.firstPaymentCurrency ? ` ${gate.firstPaymentCurrency}` : ""}`;
    lines.push(gate.firstPaymentReceivedDate
      ? [`${money}, получен `, { date: stripDay(gate.firstPaymentReceivedDate, today) }]
      : gate.firstPaymentDueDate
        ? [`${money}, ожидается `, { date: stripDay(gate.firstPaymentDueDate, today) }]
        : [money]);
  }
  if (gate.contractEvidenceReference) lines.push([`Договор: ${gate.contractEvidenceReference}`]);
  if (gate.firstPaymentEvidenceReference) lines.push([`Платёж: ${gate.firstPaymentEvidenceReference}`]);
  if (lines.length === 0) return null;
  return Object.freeze(lines.flatMap((line, index) => (index === 0 ? [...line] : [" · ", ...line])));
}
