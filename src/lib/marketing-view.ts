/**
 * Правила честных чисел раздела «Маркетинг» (план §6) — чистые функции без доступа к данным:
 *
 *  - знаменатель всегда виден: «7 из 23»; доля в процентах — только при знаменателе от 10;
 *  - знаменатель 0 — «—», а не 0 %;
 *  - деньги — минорные единицы и своя валюта, валюты не складываются;
 *  - цена заявки — три уровня и только при одной валюте расхода за период, иначе «—» с причиной;
 *    при знаменателе меньше 10 — только число заявок, без цены (как доли);
 *  - анкеты кабинета (`cabinetForms`) лежат в «Не известно», но источником заявки не являются: в долю
 *    «источник не известен», сигнал и цену «включая неизвестные» они не входят.
 */
import type { MarketingOverview, MoneyTotal, MarketingLeadFilters } from "./marketing-contract.ts";
import { marketingLeadFilterParams } from "./marketing-contract.ts";

/** Порог, с которого доли имеют смысл (план §6): ниже — только количества. */
export const MARKETING_MIN_FOR_SHARE = 10;
/** Порог сигнала «источник не известен у большинства»: доля больше 40 % при 10+ заявках. */
export const UNKNOWN_SHARE_SIGNAL_PERCENT = 40;
export const RECENT_DAYS_FOR_SIGNAL = 3;
const NBSP = " ";

/** «7 из 23»; знаменатель 0 — «—». Процент добавляется только при знаменателе от 10. */
export function shareText(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const base = `${part.toLocaleString("ru-RU")} из ${whole.toLocaleString("ru-RU")}`;
  return whole >= MARKETING_MIN_FOR_SHARE ? `${base} · ${Math.round((part * 100) / whole)}${NBSP}%` : base;
}

/** Сумма из минорных единиц (две цифры после запятой): «1 200 USD», «1 200,50 USD»; BigInt — без потери точности. */
export function formatMinor(amountMinor: string, currency: string): string {
  const value = BigInt(amountMinor), hundred = BigInt(100);
  const major = value / hundred, cents = Number(value % hundred);
  const head = major.toLocaleString("ru-RU");
  const tail = cents === 0 ? "" : `,${String(cents).padStart(2, "0")}`;
  return `${head}${tail}${NBSP}${currency}`;
}

/** Сумма в минорных единицах строкой → число для цены (расход ограничен 10^12 минорных, безопасно для Number). */
function minorNumber(amountMinor: string): number {
  return Number(amountMinor);
}

/** Неизвестный источник среди заявок, у которых источник вообще мог быть назван: без анкет кабинета. */
export function unknownSource(overview: MarketingOverview): Readonly<{ unknown: number; whole: number }> {
  const { cabinetForms, total, channels } = overview.cohort;
  const unknown = channels.find((row) => row.channel === "unknown")?.leads ?? 0;
  return { unknown: Math.max(unknown - cabinetForms, 0), whole: Math.max(total - cabinetForms, 0) };
}

export type CostLevel = Readonly<{
  key: "tagged" | "by_word" | "with_unknown";
  title: string;
  /** Заявок в знаменателе этого уровня. */
  leads: number;
  /** Цена одной заявки в минорных единицах (с долями); null — знаменатель 0 или меньше 10 заявок. */
  perLeadMinor: number | null;
  /** Заявок меньше порога: называем количество, цену — нет. */
  fewLeads: boolean;
}>;
export type CostPerLead =
  | Readonly<{ status: "no_spend" }>
  /** Расход периода в нескольких валютах: цену назвать нельзя, суммы не складываются. */
  | Readonly<{ status: "mixed_currencies"; currencies: readonly string[] }>
  | Readonly<{ status: "single"; currency: string; spendMinor: string; levels: readonly CostLevel[] }>;

/** Цена одной заявки в минорных единицах, форматируется как сумма: «12,50 USD». */
export function formatPerLead(perLeadMinor: number, currency: string): string {
  return formatMinor(String(Math.round(perLeadMinor)), currency);
}

/**
 * Цена заявки Instagram-рекламы — три уровня, не одно число (план §6): «по метке» — лиды рекламы с
 * меткой; «со слов клиента» — все лиды канала «Instagram — реклама» (метка и слова клиента);
 * «включая неизвестные» — и лиды с неизвестным источником. Расход — только записи, целиком
 * лежащие в периоде (`insideTotals`); частично пересекающиеся в цену не входят.
 */
export function costPerLead(overview: MarketingOverview): CostPerLead {
  const totals: readonly MoneyTotal[] = overview.spend.insideTotals;
  if (totals.length === 0) return { status: "no_spend" };
  if (totals.length > 1) return { status: "mixed_currencies", currencies: totals.map((one) => one.currency) };
  const [spend] = totals;
  const ads = overview.cohort.channels.find((row) => row.channel === "instagram_ads");
  const unknown = overview.cohort.channels.find((row) => row.channel === "unknown");
  if (!ads || !unknown) return { status: "no_spend" };
  const level = (key: CostLevel["key"], title: string, leads: number): CostLevel => ({
    key, title, leads, fewLeads: leads > 0 && leads < MARKETING_MIN_FOR_SHARE,
    perLeadMinor: leads >= MARKETING_MIN_FOR_SHARE ? minorNumber(spend.amountMinor) / leads : null,
  });
  return {
    status: "single", currency: spend.currency, spendMinor: spend.amountMinor,
    levels: [
      level("tagged", "по метке", ads.basis.utm),
      level("by_word", "со слов клиента", ads.leads),
      level("with_unknown", "включая неизвестные", ads.leads + unknownSource(overview).unknown),
    ],
  };
}

export type MarketingSignal = Readonly<{ key: "spend_without_leads" | "unknown_share"; text: string }>;

/**
 * Строка сигналов — только в интерфейсе, без рассылок, и только два сигнала:
 *  1. расход есть, а заявок за последние 3 дня нет (`recent` — обзор узкого периода; null — не прочитан,
 *     сигнала нет);
 *  2. источник не известен у больше чем 40 % заявок при 10+ заявках периода.
 */
export function marketingSignals(
  overview: MarketingOverview,
  recent: Readonly<{ leads: number; spendRows: number }> | null,
): readonly MarketingSignal[] {
  const signals: MarketingSignal[] = [];
  if (recent && recent.spendRows > 0 && recent.leads === 0) {
    signals.push({ key: "spend_without_leads", text: `Расход вводился, а заявок за последние ${RECENT_DAYS_FOR_SIGNAL} дня нет.` });
  }
  const { unknown, whole } = unknownSource(overview);
  if (whole >= MARKETING_MIN_FOR_SHARE && unknown * 100 > UNKNOWN_SHARE_SIGNAL_PERCENT * whole) {
    signals.push({ key: "unknown_share", text: `Источник не известен — ${shareText(unknown, whole)}.` });
  }
  return signals;
}

/** ISO-дата со сдвигом в днях (даты Бишкека — сутки без часовых поясов). */
export function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export type MarketingView = "overview" | "leads";
export const MARKETING_VIEWS: readonly Readonly<{ key: MarketingView; title: string }>[] = [
  { key: "overview", title: "Обзор" },
  { key: "leads", title: "Заявки" },
];
export function parseMarketingView(value: unknown): MarketingView {
  return value === "leads" ? "leads" : "overview";
}

/**
 * Адрес раздела: вид, период и фильтры — только ключи и даты. Имён, телефонов и курсора в адресе нет
 * (следующая страница списка читается действием, а не ссылкой).
 */
export function marketingHref(input: Readonly<{
  view: MarketingView;
  period: Readonly<{ key: string; from?: string; to?: string }>;
  filters?: MarketingLeadFilters;
}>): string {
  const query = new URLSearchParams();
  if (input.view === "leads") query.set("view", "leads");
  if (input.period.key !== "month") query.set("period", input.period.key);
  if (input.period.key === "custom" && input.period.from && input.period.to) {
    query.set("from", input.period.from);
    query.set("to", input.period.to);
  }
  if (input.view === "leads" && input.filters) for (const [key, value] of Object.entries(marketingLeadFilterParams(input.filters))) query.set(key, value);
  const text = query.toString();
  return text ? `/v3/marketing?${text}` : "/v3/marketing";
}

/** Ввод суммы расхода («1200», «1 200,50») → минорные единицы; 1..10^12, не больше двух знаков после запятой. */
export function parseSpendAmount(input: string): number | null {
  const clean = input.replace(/[\s ]/g, "");
  const match = /^(\d{1,10})(?:[.,](\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(minor) && minor >= 1 && minor <= 1_000_000_000_000 ? minor : null;
}

const MOMENT = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** «06.10, 14:32» по времени Бишкека. */
export function formatBishkekMoment(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.valueOf()) ? MOMENT.format(date) : "—";
}
/** «2026-10-06» → «06.10.2026». */
export function formatIsoDay(iso: string): string {
  return iso.split("-").reverse().join(".");
}

/** Слово этапа: для закрытых — причина закрытия по состоянию лида. */
export function stageWord(stage: string, lifecycleState: string, titles: Readonly<Record<string, string | undefined>>): string {
  if (stage === "closed") {
    return lifecycleState === "disqualified" ? "Отказ" : lifecycleState === "archived" ? "В архиве" : "Закрыт";
  }
  return titles[stage] ?? "—";
}
