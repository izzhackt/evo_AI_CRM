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
 */
import type { LeadHandoffStrip } from "../../../lib/sales-numbers-contract.ts";
import { dayInOrganizationTimezone } from "../../../lib/platform-task-deadline.ts";
import { salesStage } from "../../../lib/v3/wording.ts";

export type HandoffStripItemKey = "contract" | "payment" | "report" | "curator" | "accepted";

export type HandoffStripItem = Readonly<{
  key: HandoffStripItemKey;
  label: string;
  /** done — доказательство есть; missing — нет; attention — есть, но с оговоркой (словами). */
  state: "done" | "missing" | "attention";
  /** Слова значения: имя куратора, «в архиве», «нужно уточнить»; null — только дата или «нет». */
  text: string | null;
  /** ДД.ММ (ДД.ММ.ГГГГ, если не этот год) по времени организации. */
  date: string | null;
}>;

export type HandoffStripView = Readonly<{
  /** Название этапа, как у колонки доски; «Лид закрыт» для закрытого. */
  stageTitle: string;
  /** «Передано 18.09 · Айгүл Осмонова · принято 19.09»; null — передачи не было. */
  summary: string | null;
  items: readonly HandoffStripItem[];
  /** Чего не хватает переданному лиду — словами; до передачи пусто. */
  warnings: readonly string[];
}>;

const LABEL: Record<HandoffStripItemKey, string> = {
  contract: "Договор",
  payment: "Первый платёж",
  report: "Запись в отчёте",
  curator: "Куратор",
  accepted: "Принято",
};

/** Дата `YYYY-MM-DD` → ДД.ММ; другой год — ДД.ММ.ГГГГ. */
export function stripDay(day: string, today: string): string {
  const [year, month, date] = day.split("-");
  return year === today.slice(0, 4) ? `${date}.${month}` : `${date}.${month}.${year}`;
}

/** Метка времени → день организации → ДД.ММ. */
export function stripMoment(value: string, today: string): string {
  return stripDay(dayInOrganizationTimezone(new Date(value)), today);
}

export function handoffStripView(
  strip: LeadHandoffStrip,
  options: Readonly<{ now: Date }>,
): HandoffStripView {
  const today = dayInOrganizationTimezone(options.now);
  const moment = (value: string | null) => (value === null ? null : stripMoment(value, today));
  const items: HandoffStripItem[] = [];
  const warnings: string[] = [];
  const handedOff = strip.handoff !== null;

  items.push(strip.contract.confirmed
    ? { key: "contract", label: LABEL.contract, state: "done", text: null, date: moment(strip.contract.confirmedAt) }
    : { key: "contract", label: LABEL.contract, state: "missing", text: null, date: null });

  items.push(strip.firstPayment.receivedDate
    ? { key: "payment", label: LABEL.payment, state: "done", text: null, date: stripDay(strip.firstPayment.receivedDate, today) }
    : { key: "payment", label: LABEL.payment, state: "missing", text: null, date: null });

  // Роль без чтения отчёта продаж не видит пункта вовсе — не «нет».
  if (strip.report.status === "available") {
    const record = strip.report.record;
    if (record === null) {
      items.push({ key: "report", label: LABEL.report, state: "missing", text: null, date: null });
      if (handedOff) warnings.push("Записи о продаже в отчёте нет.");
    } else if (record.archived) {
      items.push({ key: "report", label: LABEL.report, state: "attention", text: "в архиве", date: null });
      if (handedOff) warnings.push("Запись о продаже в архиве и в продажи не входит.");
    } else if (record.saleDate === null) {
      items.push({ key: "report", label: LABEL.report, state: "attention", text: "без даты продажи", date: null });
      if (handedOff) warnings.push("В записи отчёта нет даты продажи, поэтому в продажи она не входит.");
    } else {
      items.push({ key: "report", label: LABEL.report, state: "done", text: null, date: stripDay(record.saleDate, today) });
    }
  }

  const curator = strip.curator;
  items.push(curator
    ? { key: "curator", label: LABEL.curator, state: "done", text: curator.displayName, date: moment(curator.assignedAt) }
    : { key: "curator", label: LABEL.curator, state: "missing", text: null, date: null });
  if (handedOff && curator === null) warnings.push("Куратор не назначен: дело ждёт назначения.");

  const acceptance = strip.acceptance;
  if (acceptance?.decision === "accepted") {
    items.push({ key: "accepted", label: LABEL.accepted, state: "done", text: null, date: moment(acceptance.at) });
  } else if (acceptance?.decision === "clarification_requested") {
    items.push({ key: "accepted", label: LABEL.accepted, state: "attention", text: "нужно уточнить", date: moment(acceptance.at) });
    warnings.push("Куратор просит уточнить передачу.");
  } else if (acceptance?.decision === "declined") {
    items.push({ key: "accepted", label: LABEL.accepted, state: "attention", text: "отклонено", date: moment(acceptance.at) });
  } else {
    items.push({ key: "accepted", label: LABEL.accepted, state: "missing", text: curator ? "ждёт ответа" : null, date: null });
  }

  let summary: string | null = null;
  if (strip.handoff) {
    const parts = [`Передано ${stripMoment(strip.handoff.completedAt, today)}`];
    if (curator) parts.push(curator.displayName);
    if (acceptance?.decision === "accepted") parts.push(`принято ${stripMoment(acceptance.at, today)}`);
    else if (curator && acceptance === null) parts.push("ждёт принятия");
    summary = parts.join(" · ");
  }

  return Object.freeze({
    stageTitle: strip.stage === "closed" ? "Лид закрыт" : salesStage(strip.stage) ?? "Этап неизвестен",
    summary,
    items: Object.freeze(items.map((item) => Object.freeze(item))),
    warnings: Object.freeze(warnings),
  });
}
