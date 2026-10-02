/**
 * Полоса «Передача» в Lead 360 (Э2 «Честные числа», решения владельца
 * 26.09.2026; Э8.4 — 28.09.2026): чистая логика без React. По ней рисуют
 * карточку, статический рендер и unit-тест.
 *
 * Вместо красного «Договор и оплата: ожидает условий», который ничего не
 * запрещал, — пять доказательств передачи, каждое «есть с датой» или «нет»
 * из настоящего чтения (`staff_lead_handoff_strip_v1`): Договор · Оплата ·
 * Запись в отчёте · Куратор · Принято. Условие передачи — только
 * доказательство, не запрет: до передачи полоса нейтральна. После передачи —
 * строка «Передано ДД.ММ · куратор · принято ДД.ММ»; если передаче не хватает
 * доказательства и это можно исправить, предупреждение называет действие и
 * ведёт к нему («Открыть запись», «Оформить продажу», «Назначить куратора»).
 * Предупреждения, которые нечем исправить, не показываются.
 *
 * Договор и оплата — одно место (Э8.4): полоса учитывает и договор и платежи
 * дела (чтение 188, `staff_case_agreement_v1`), если дело есть, — «Договор —
 * загружен ДД.ММ», «Оплата — оплачено N из M»; подтверждение вручную
 * (условия передачи) — «подтверждён вручную», «первый платёж ДД.ММ».
 *
 * Продажа, сохранённая из отчёта в уже открытый кабинет (путь 208), ничего не
 * подтверждает в строке условий: её договор и оплата — сама запись отчёта
 * («по отчёту»), а не «—». Даты — один формат (DESIGN.md): ДД.ММ, другой год —
 * ДД.ММ.ГГ; в тексте дата — отдельный кусок, его рисуют JetBrains Mono.
 */
import type { LeadHandoffStrip } from "../../../lib/sales-numbers-contract.ts";
import type { CaseAgreement } from "../../../lib/platform-case-agreement-contract.ts";
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

/** Предупреждение всегда называет действие и ведёт к нему; без действия его нет. */
export type HandoffStripWarning = Readonly<{
  text: StripText;
  /** Где это исправить: запись отчёта, форма продажи, дело. */
  href: string;
  /** Слово ссылки: «Открыть запись», «Оформить продажу», «Назначить куратора», «Открыть дело». */
  action: string;
}>;

export type HandoffStripView = Readonly<{
  /** Название этапа, как у колонки доски; «Лид закрыт» для закрытого. */
  stageTitle: string;
  /** «Передано 18.09 · Куратор · принято 19.09»; null — передачи не было. */
  summary: StripText | null;
  items: readonly HandoffStripItem[];
  /** Чего не хватает переданному лиду и что с этим сделать; до передачи пусто. */
  warnings: readonly HandoffStripWarning[];
  /**
   * «Связать с лидом» (254): запись отчёта просто связана с этим лидом (не
   * продажа pipeline) — «Запись в отчёте — связана: ДД.ММ», рядом с
   * «Оформить продажу», а не в самой полосе (та остаётся на настоящей
   * продаже). null — связанной записи нет.
   */
  linkedRecord: HandoffStripWarning | null;
}>;

/**
 * Договор и платежи дела (188) словами полосы. null — дела нет или чтение
 * договора и платежей не отдало (нет права, сбой): полоса остаётся на
 * подтверждении вручную и записи отчёта, ничего не угадывая.
 */
export type StripCaseMoney = Readonly<{
  /** Когда загружен текущий договор дела; null — договора в деле нет. */
  contractUploadedAt: string | null;
  /** «оплачено 600 из 1 500 USD»; null — одной суммой не сказать (нет стоимости, разные валюты). */
  paidText: string | null;
  /** День первого платежа дела (`YYYY-MM-DD`); null — платежей нет или всё возвращено. */
  firstPaymentOn: string | null;
}>;

export type HandoffStripOptions = Readonly<{
  now: Date;
  /** Договор и платежи дела; null или нет — только подтверждение вручную и отчёт. */
  caseMoney?: StripCaseMoney | null;
  /** Сумма первого платежа из подтверждения вручную (условия передачи). */
  firstPayment?: Readonly<{ amount: number | null; currency: string | null }> | null;
  /**
   * Куда ведут предупреждения: дело (если этот сотрудник его открывает),
   * форма продажи (если он записывает продажи), назначение куратора (право
   * `case.curator.assign`). Чего нет — того предупреждения нет.
   */
  links?: Readonly<{ caseHref: string | null; saleHref: string | null; assignCurator: boolean }> | null;
}>;

const LABEL: Record<HandoffStripItemKey, string> = {
  contract: "Договор",
  payment: "Оплата",
  report: "Запись в отчёте",
  curator: "Куратор",
  accepted: "Принято",
};

/** Одно слово ожидания ответа куратора — и в строке, и в полосе. */
export const AWAITING_ANSWER = "ждёт ответа";

/** Итог предупреждения о записи отчёта: одно слово для всех трёх случаев. */
const NOT_IN_PLAN = " — в план месяца не считается";

const amount = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

/** Сумма и валюта не разрываются переносом: «600 USD». */
function money(value: number, currency: string | null): string {
  return currency ? `${amount.format(value)}\u00a0${currency}` : amount.format(value);
}

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

/**
 * Договор и платежи дела (188) → слова полосы. Оплачено — с учётом
 * возвратов, как в блоке «Договор и оплата»; «N из M» — только когда
 * стоимость и платежи в одной валюте.
 */
export function stripCaseMoney(agreement: Pick<CaseAgreement,
  "contractCurrent" | "payments" | "paidMinor" | "costMinor" | "costCurrency" | "currencyMismatch">): StripCaseMoney {
  const payments = agreement.payments.filter((payment) => payment.eventType === "payment");
  const paid = BigInt(agreement.paidMinor);
  const received = payments.length > 0 && paid > BigInt(0);
  const oneCurrency = !agreement.currencyMismatch && agreement.costCurrency !== null && agreement.costMinor !== null;
  return Object.freeze({
    contractUploadedAt: agreement.contractCurrent?.uploadedAt ?? null,
    paidText: received && oneCurrency
      ? `оплачено ${amount.format(Number(paid) / 100)} из ${money(Number(agreement.costMinor) / 100, agreement.costCurrency)}`
      : null,
    firstPaymentOn: received ? payments.map((payment) => payment.occurredOn).sort()[0] ?? null : null,
  });
}

export function handoffStripView(
  strip: LeadHandoffStrip,
  options: HandoffStripOptions,
): HandoffStripView {
  const today = dayInOrganizationTimezone(options.now);
  const moment = (value: string | null) => (value === null ? null : stripMoment(value, today));
  const caseMoney = options.caseMoney ?? null;
  const links = options.links ?? null;
  const items: HandoffStripItem[] = [];
  const warnings: HandoffStripWarning[] = [];
  const handedOff = strip.handoff !== null;
  const found = strip.report.status === "available" ? strip.report.record : null;
  // 254: связанная запись (link: 'linked') — не продажа. Она никогда не
  // отвечает за «Запись в отчёте», договор или оплату этой полосы; своё
  // место — `linkedRecord`, рядом с «Оформить продажу».
  const record = found?.link === "sale" ? found : null;
  const linkedFound = found?.link === "linked" ? found : null;
  // Запись не в архиве — это продажа; её поля — доказательство договора и оплаты.
  const sale = record && !record.archived ? record : null;
  // Передачу доказала запись отчёта, а роль отчёт не читает: доказательство есть, но не здесь.
  const inUnreadReport = strip.report.status === "denied" && strip.handoff?.evidence === "sales_report";
  const linkedRecord: HandoffStripWarning | null = linkedFound ? {
    text: linkedFound.saleDate
      ? ["Запись в отчёте — связана: ", { date: stripDay(linkedFound.saleDate, today) }]
      : ["Запись в отчёте — связана"],
    href: salesRecordHref(linkedFound), action: "Открыть запись",
  } : null;

  // Договор: загруженный в дело, подтверждённый вручную, по записи отчёта — именно в этом порядке.
  if (caseMoney?.contractUploadedAt) {
    items.push({ key: "contract", label: LABEL.contract, state: "done", text: "загружен", date: moment(caseMoney.contractUploadedAt) });
  } else if (strip.contract.confirmed) {
    items.push({ key: "contract", label: LABEL.contract, state: "done", text: "подтверждён вручную", date: moment(strip.contract.confirmedAt) });
  } else if (sale && (sale.saleDate !== null || sale.hasContractNumber)) {
    items.push({ key: "contract", label: LABEL.contract, state: "done", text: "по отчёту",
      date: sale.saleDate === null ? null : stripDay(sale.saleDate, today) });
  } else if (inUnreadReport) {
    items.push({ key: "contract", label: LABEL.contract, state: "elsewhere", text: "в отчёте продаж", date: null });
  } else {
    items.push({ key: "contract", label: LABEL.contract, state: "missing", text: null, date: null });
  }

  // Оплата: платежи дела, первый платёж вручную, оплата по записи отчёта.
  const firstPayment = options.firstPayment ?? null;
  const expected = firstPayment && firstPayment.amount !== null ? money(firstPayment.amount, firstPayment.currency) : null;
  if (caseMoney?.paidText) {
    items.push({ key: "payment", label: LABEL.payment, state: "done", text: caseMoney.paidText, date: null });
  } else if (caseMoney?.firstPaymentOn) {
    items.push({ key: "payment", label: LABEL.payment, state: "done", text: "первый платёж", date: stripDay(caseMoney.firstPaymentOn, today) });
  } else if (strip.firstPayment.receivedDate) {
    items.push({ key: "payment", label: LABEL.payment, state: "done", text: expected ? `первый платёж ${expected}` : "первый платёж",
      date: stripDay(strip.firstPayment.receivedDate, today) });
  } else if (sale?.paid) {
    items.push({ key: "payment", label: LABEL.payment, state: "done",
      text: `по отчёту: оплачено ${money(sale.paid.minor / 100, sale.paid.currency)}`, date: null });
  } else if (inUnreadReport) {
    items.push({ key: "payment", label: LABEL.payment, state: "elsewhere", text: "в отчёте продаж", date: null });
  } else {
    items.push({ key: "payment", label: LABEL.payment, state: "missing", text: null, date: null });
  }

  // Роль без чтения отчёта продаж не видит пункта вовсе — не «нет».
  if (strip.report.status === "available") {
    if (record === null) {
      items.push({ key: "report", label: LABEL.report, state: "missing", text: null, date: null });
      if (handedOff && links?.saleHref) {
        warnings.push({ text: [`Продажа не записана в отчёт${NOT_IN_PLAN}`], href: links.saleHref, action: "Оформить продажу" });
      }
    } else if (record.archived) {
      items.push({ key: "report", label: LABEL.report, state: "attention", text: "в архиве", date: null });
      if (handedOff) warnings.push({ text: [`Продажа в отчёте в архиве${NOT_IN_PLAN}`], href: salesRecordHref(record), action: "Открыть запись" });
    } else if (record.saleDate === null) {
      items.push({ key: "report", label: LABEL.report, state: "attention", text: "без даты продажи", date: null });
      if (handedOff) warnings.push({ text: [`В записи отчёта нет даты продажи${NOT_IN_PLAN}`], href: salesRecordHref(record), action: "Открыть запись" });
    } else {
      items.push({ key: "report", label: LABEL.report, state: "done", text: null, date: stripDay(record.saleDate, today) });
    }
  }

  const curator = strip.curator;
  const acceptance = strip.acceptance;
  const declined = acceptance?.decision === "declined";
  // Ответ записать нельзя (у дела нет строки 088): «ждёт ответа» было бы шагом, который никто
  // не сделает. С миграции 258 продажа в открытый кабинет (путь 208) пишет эту строку, так что
  // здесь остаётся только дело без неё и без доказательства, из которого её можно восстановить.
  const unrecordable = strip.handoff !== null && !strip.handoff.acceptanceRecordable;
  // Назначить куратора — в деле, у того, кто назначает (`case.curator.assign`).
  const assignHref = links?.assignCurator ? links.caseHref : null;
  items.push(curator
    ? { key: "curator", label: LABEL.curator, state: "done", text: curator.displayName, date: moment(curator.assignedAt) }
    : { key: "curator", label: LABEL.curator, state: "missing", text: null, date: null });

  if (acceptance?.decision === "accepted") {
    items.push({ key: "accepted", label: LABEL.accepted, state: "done", text: null, date: moment(acceptance.at) });
  } else if (acceptance?.decision === "clarification_requested") {
    items.push({ key: "accepted", label: LABEL.accepted, state: "attention", text: "нужно уточнить", date: moment(acceptance.at) });
    if (links?.caseHref) warnings.push({ text: ["Куратор просит уточнить передачу"], href: links.caseHref, action: "Открыть дело" });
  } else if (declined) {
    items.push({ key: "accepted", label: LABEL.accepted, state: "attention", text: "отклонено", date: moment(acceptance.at) });
    if (curator === null && assignHref) {
      warnings.push({ text: ["Куратор отклонил передачу ", { date: stripMoment(acceptance.at, today) }, " — дело ждёт нового куратора"],
        href: assignHref, action: "Назначить куратора" });
    }
  } else if (curator && unrecordable) {
    items.push({ key: "accepted", label: LABEL.accepted, state: "missing", text: "не отмечается", date: null });
  } else {
    items.push({ key: "accepted", label: LABEL.accepted, state: "missing", text: curator ? AWAITING_ANSWER : null, date: null });
  }
  if (handedOff && curator === null && !declined && assignHref) {
    warnings.push({ text: ["Куратор не назначен — дело ждёт назначения"], href: assignHref, action: "Назначить куратора" });
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
    linkedRecord,
  });
}

/**
 * Строка под полосой — то, чего нет в самих доказательствах: ожидаемый
 * первый платёж (пока он не получен; полученный — уже в «Оплате» с суммой и
 * датой) и ссылки-доказательства подтверждения вручную.
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
  if (gate.contractConfirmed && gate.firstPaymentAmount !== null && !gate.firstPaymentReceivedDate) {
    const expected = `Первый платёж ${money(gate.firstPaymentAmount, gate.firstPaymentCurrency)}`;
    lines.push(gate.firstPaymentDueDate ? [`${expected}, ожидается `, { date: stripDay(gate.firstPaymentDueDate, today) }] : [expected]);
  }
  if (gate.contractEvidenceReference) lines.push([`Договор: ${gate.contractEvidenceReference}`]);
  if (gate.firstPaymentEvidenceReference) lines.push([`Оплата: ${gate.firstPaymentEvidenceReference}`]);
  if (lines.length === 0) return null;
  return Object.freeze(lines.flatMap((line, index) => (index === 0 ? [...line] : [" · ", ...line])));
}
