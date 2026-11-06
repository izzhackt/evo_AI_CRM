/**
 * Данные «Отчёта продаж» нового вида — только то, что видно на экране, простыми значениями (строки, числа): сервер страницы
 * готовит их из чтений (`readSalesRegisterPage`), клиентский кусок рисует. Поля записей, которых на экране нет (`sourceSha256`,
 * `sourceKey`, `notes`, телефон), сюда не попадают; запись целиком — в панели, её рисует сервер.
 */
export type SalesRowData = Readonly<{
  id: string;
  /** Адрес отчёта с открытой записью (`?record=`). */
  href: string;
  name: string;
  /** «Страна · программа» — как раньше, для подписи записи. */
  place: string;
  /** Колонки таблицы по таблице владельца: каждая — как записана в отчёте (пусто — «—»), ничего не придумывается. */
  country: string;
  university: string;
  program: string;
  intake: string;
  /** Статус оплаты, как записан в отчёте. */
  status: string;
  /** Долг числом (стоимость − оплачено в валюте договора) для подсветки; null — долга нет в данных. */
  debtMinor: number | null;
  manager: string;
  /** Дата продажи ISO (для сортировки) и её слова: «ДД.ММ» и год другой продажи под ней. */
  signingDate: string | null;
  dateDay: string | null;
  dateYear: string | null;
  reportMonth: Readonly<{ dateTime: string; compact: string; words: string }> | null;
  cost: string | null;
  costMinor: number | null;
  paid: string | null;
  paidTitle: string | null;
  paidMinor: number | null;
  remainder: string | null;
  remainderTitle: string | null;
  noRemainder: string | null;
  /** «Уточнить: …», «Сверено», «Статус не указан», «В архиве» словами записи. */
  reviewText: string;
  reviewTone: "review" | "quiet";
  refusal: Readonly<{ word: string; tone: "warn" | "danger" }> | null;
  /** «Убрать» / «Вернуть» (307): у тех, кто может менять записи, и не в «Архиве». */
  action: Readonly<{ version: number; withdrawn: boolean; requestId: string }> | null;
}>;

export type SalesHeadlineData =
  | Readonly<{ kind: "error"; text: string; retryHref: string }>
  | Readonly<{
    kind: "ok";
    sales: number;
    target: number | null;
    /** «по дате продажи, без архива и без фильтров». */
    basis: string;
    /** «осталось 16» / «план выполнен»; null — плана нет. */
    left: string | null;
    notes: readonly Readonly<{ lead: string; links: readonly Readonly<{ text: string; href: string | null }>[] }>[];
  }>;

export type SalesMoneyData = Readonly<{
  caption: string;
  refusal: string | null;
  lines: readonly Readonly<{ currency: string; cost: string; paid: string; rest: string | null }>[];
  showRest: boolean;
  cross: readonly Readonly<{ key: string; label: string; title: string; sr: string; cost: string | null; paid: string | null }>[];
  footnote: string;
}>;

export type SalesCashData =
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "ok"; totals: readonly Readonly<{ currency: string; payments: string; refunds: string; net: string }>[] }>;

export type SalesSavedData = Readonly<{
  name: string;
  facts: string;
  caseCreated: boolean;
  openHref: string | null;
}>;

/** «Продажи по менеджерам» за период: число продаж и суммы стоимости по валютам, как записаны (без пересчёта). */
export type SalesManagerSummaryLine = Readonly<{ name: string; count: number; sums: readonly string[]; noCost: number }>;
export type SalesManagerSummaryData = Readonly<{ managers: readonly SalesManagerSummaryLine[]; total: SalesManagerSummaryLine }>;
