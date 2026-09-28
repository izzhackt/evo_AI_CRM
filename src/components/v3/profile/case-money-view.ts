import {
  financeMoney,
  type CaseAgreement,
  type CaseAgreementPayment,
  type CaseAgreementTranche,
} from "../../../lib/platform-case-agreement-contract.ts";
import type { PlatformCaseContractWorkspace } from "../../../lib/platform-contract-workflow.ts";
import { dayInOrganizationTimezone } from "../../../lib/platform-task-deadline.ts";
import { caseMoneyWords } from "../../../lib/v3/wording.ts";

import { formatQueueDay } from "../queue/due-bucket.ts";

/**
 * Вкладка «Договор и оплата» (Э8.3): чистые расчёты сводки и адреса панелей.
 * Серверные части и клиентский лист берут их отсюда: константы из модуля с
 * "use client" на сервере были бы ссылками на клиент, а не значениями.
 */

/** Пункт «⋯»: id панели на странице и её название. */
export type CaseMoneyPanelEntry = Readonly<{ id: string; label: string }>;

/**
 * id панелей — они же якоря адреса (`tab=money#money-stops`). Подготовка
 * договора держит и прежний якорь `#contract-workflow` (адрес итога операции
 * договора): он внутри своей панели и открывает её.
 */
export const CASE_MONEY_PANEL = {
  contract: "money-contract",
  obligations: "money-obligations",
  stops: "money-stops",
  operations: "money-operations",
  service: "money-service",
} as const;

/** Действие строки сводки: подчёркнутая подпись 44 px, без рамки. */
export const CASE_MONEY_ROW_ACTION = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/** День «ДД.ММ» (год «.ГГ» — только не в текущем году) для даты `YYYY-MM-DD` по Бишкеку. */
export function moneyDay(day: string, today: string): string {
  return formatQueueDay(day, today);
}

/** День момента по Бишкеку, «ДД.ММ». */
export function moneyMomentDay(iso: string, today: string): string {
  return formatQueueDay(dayInOrganizationTimezone(new Date(iso)), today);
}

type Sum = Readonly<{ currency: string; minor: bigint }>;

/**
 * Суммы по валютам. Порядок — `order` (валюта стоимости, затем валюты
 * траншей), остальные — в порядке появления. Валюты не пересчитываются.
 */
function byCurrency(entries: readonly Sum[], order: readonly string[]): readonly Sum[] {
  const sums = new Map<string, bigint>();
  for (const currency of order) if (entries.some((entry) => entry.currency === currency)) sums.set(currency, BigInt(0));
  for (const entry of entries) sums.set(entry.currency, (sums.get(entry.currency) ?? BigInt(0)) + entry.minor);
  return [...sums].map(([currency, minor]) => ({ currency, minor }));
}

/** Оплачено по каждой валюте: оплаты минус возвраты — те же события, что сумма сервера. */
export function casePaidByCurrency(payments: readonly CaseAgreementPayment[], order: readonly string[] = []): readonly string[] {
  return byCurrency(payments.map((payment) => ({
    currency: payment.currency,
    minor: payment.eventType === "refund" ? -BigInt(payment.amountMinor) : BigInt(payment.amountMinor),
  })), order).map((sum) => financeMoney(sum.minor.toString(), sum.currency));
}

/**
 * Остаток по траншам в каждой валюте (для разных валют стоимости и траншей).
 * Валюта, где остатка нет, не называется; остатка нет нигде — один ноль.
 */
export function caseOutstandingByCurrency(tranches: readonly CaseAgreementTranche[], order: readonly string[] = []): readonly string[] {
  const sums = outstandingSums(tranches, order);
  const open = sums.filter((sum) => sum.minor !== BigInt(0));
  return (open.length > 0 ? open : sums.slice(0, 1)).map((sum) => financeMoney(sum.minor.toString(), sum.currency));
}

/** Валюты, где остаток по траншам ниже нуля, — переплата; порядок тот же, что у остатка. */
export function caseOverpaidCurrencies(tranches: readonly CaseAgreementTranche[], order: readonly string[] = []): readonly string[] {
  return outstandingSums(tranches, order).filter((sum) => sum.minor < BigInt(0)).map((sum) => sum.currency);
}

function outstandingSums(tranches: readonly CaseAgreementTranche[], order: readonly string[]): readonly Sum[] {
  return byCurrency(tranches.map((tranche) => ({ currency: tranche.currency, minor: BigInt(tranche.outstandingMinor) })), order);
}

export type CaseMoneySummary = Readonly<{
  /** «1 500,00 USD»; null — стоимость не указана. */
  cost: string | null;
  /** Стоимость без валюты: сумма есть, валюты нет. */
  costWithoutCurrency: boolean;
  /** Оплачено по валютам; пусто — оплат нет. */
  paid: readonly string[];
  /** Были возвраты: оплачено — с их учётом. */
  refunds: boolean;
  /** Остаток: значения и пояснение словами; пусто — посчитать не из чего. */
  remaining: Readonly<{ values: readonly string[]; note: string | null }>;
  /** Сумма траншей не равна стоимости (одна валюта): «Транши: X из Y». */
  tranchesAgainstCost: string | null;
}>;

/**
 * Сводка из чтения 189. Одна валюта — остаток сервера (стоимость минус
 * оплаченное). Разные валюты стоимости и траншей — ни одна сумма не
 * пересчитывается: оплачено и остаток по траншам — по каждой валюте
 * отдельно; остаток сервера (`remaining_minor`) и его оплачено (сумма разных
 * валют) здесь не используются.
 */
export function caseMoneySummary(agreement: CaseAgreement): CaseMoneySummary {
  const cost = agreement.costMinor !== null && agreement.costCurrency
    ? financeMoney(agreement.costMinor, agreement.costCurrency) : null;
  const order = [...(agreement.costCurrency ? [agreement.costCurrency] : []), ...agreement.tranches.map((tranche) => tranche.currency)];
  const paid = casePaidByCurrency(agreement.payments, order);
  const refunds = agreement.payments.some((payment) => payment.eventType === "refund");
  let remaining: CaseMoneySummary["remaining"];
  if (agreement.currencyMismatch) {
    // Переплата называется, как и при одной валюте, — с валютой: суммы разных валют не сравниваются.
    const overpaid = caseOverpaidCurrencies(agreement.tranches, order);
    remaining = {
      values: caseOutstandingByCurrency(agreement.tranches, order),
      note: `по траншам, без пересчёта валют${overpaid.length > 0 ? ` · переплата в ${overpaid.join(", ")}` : ""}`,
    };
  } else if (agreement.remainingMinor !== null && agreement.costCurrency) {
    remaining = {
      values: [financeMoney(agreement.remainingMinor, agreement.costCurrency)],
      note: BigInt(agreement.remainingMinor) < BigInt(0) ? "переплата" : null,
    };
  } else {
    // Сумма есть, валюты нет — остаток не считается, и сказано почему.
    remaining = { values: [], note: agreement.costMinor !== null && !agreement.costCurrency ? "валюта стоимости не указана" : "стоимость не указана" };
  }
  return {
    cost,
    costWithoutCurrency: agreement.costMinor !== null && !agreement.costCurrency,
    paid,
    refunds,
    remaining,
    tranchesAgainstCost: !agreement.currencyMismatch && agreement.costMismatch && agreement.costCurrency && cost
      ? `Транши: ${financeMoney(agreement.trancheSumMinor, agreement.costCurrency)} из ${cost}` : null,
  };
}

/** Состояние транша словом: оплачен, просрочен (срок прошёл, есть остаток), иначе — без слова. */
export function caseTrancheState(tranche: CaseAgreementTranche, today: string): "paid" | "overdue" | null {
  const outstanding = BigInt(tranche.outstandingMinor);
  if (outstanding <= BigInt(0) && BigInt(tranche.totalPaidMinor) > BigInt(0)) return "paid";
  if (tranche.dueOn && tranche.dueOn < today && outstanding > BigInt(0)) return "overdue";
  return null;
}

export type CaseContractTemplateNote = Readonly<{
  text: string;
  link: Readonly<{ href: string; label: string }> | null;
}>;

/**
 * Предупреждение о шаблоне договора — тому, кто смотрит. Утверждённый шаблон
 * есть — предупреждать не о чем. Кто управляет шаблонами (Admin), получает
 * своё действие: утвердить — ссылкой на «Шаблоны договора» ниже; создать —
 * словами о раскрытии «Создать версию шаблона» прямо под предупреждением,
 * без второй ссылки с тем же названием. Без проверенного источника создать
 * шаблон нельзя, и экрана источников в CRM нет — это сказано прямо, без
 * ссылки. Остальным — кто это сделает.
 */
export function caseContractTemplateNote(workspace: PlatformCaseContractWorkspace): CaseContractTemplateNote | null {
  if (workspace.templates.some((template) => template.status === "approved")) return null;
  const words = caseMoneyWords.template;
  const unapproved = workspace.templates.some((template) => template.status === "draft");
  if (!workspace.canManageTemplates) {
    return { text: unapproved ? words.unapprovedForStaff : words.missingForStaff, link: null };
  }
  if (unapproved) return { text: words.unapprovedForAdmin, link: { href: "#contract-template-list", label: words.listLink } };
  if (workspace.reviewedSources.length === 0) return { text: words.missingNoSource, link: null };
  return { text: words.missingForAdmin, link: null };
}
