import type { PlatformComponentStatus } from "../platform-observability.ts";
import type { ProviderDisplayStatus } from "../provider-display-status.ts";
import { settingsBlockedWahaDetail, settingsStatusWords } from "./wording.ts";

/**
 * «Настройки → Интеграции» (Э6 плана редизайна, 27.09.2026): одна таблица из
 * уже прочитанных фактов, без чтений. Раньше состояние интеграций стояло
 * трижды — карточки «Состояния», список «Требует внимания» и карточки
 * «Интеграций»; теперь это одна строка на сервис.
 *
 * Предупреждение сверху (`blocksWork`) — только у настроенного и сломанного
 * сервиса: работа, ради которой его настраивали, стоит. «Не используется»
 * (не настраивали), «настроен, не проверен» и WhatsApp без данных о
 * подключении — факты таблицы, а не тревога: вебхук WAHA снят сознательно
 * (26.09), страница WhatsApp говорит «не подключён» сама. База данных —
 * факт раздела «Платформа» (`databaseFact`), в таблице её нет.
 *
 * «Что сделать» (правка по ревью #1079): у действия всегда есть путь —
 * ссылка внутри CRM или работа на сервере вместе с тем, кто её делает.
 * Сервер и параметры провайдеров — работа технического специалиста (так же
 * говорит «Эксплуатация» в «Платформе»): Admin передаёт её, а не ищет сам.
 * Ссылок на runbook нет: процедуры `docs/runbooks/p7b-operations.md`
 * помечены историческими и до пересмотра U11 не применяются.
 */

export type IntegrationTone = "ok" | "warn" | "blocked" | "off";

export type IntegrationRow = Readonly<{
  key: "whatsapp" | "amocrm" | "gemini";
  name: string;
  /** Состояние словом; значок и цвет его только подкрепляют. */
  state: string;
  tone: IntegrationTone;
  /** Причина словами (заблокированная сессия, неверные параметры); null — нечего добавить. */
  detail: string | null;
  /** Момент последнего наблюдения состояния; null — проверки не было. */
  checkedAt: string | null;
  /** «26.09 12:00» по Бишкеку; год — только если не текущий. */
  checkedText: string | null;
  /** Проверки у сервиса нет вовсе (читаются только параметры): «—», а не «нет данных». */
  checkable: boolean;
  /** Что не работает без сервиса, простыми словами; null — всё работает. */
  without: string | null;
  /**
   * Что сделать; null — делать нечего. `handoff` — работа на сервере и кто её
   * делает; `link` — страница CRM по этому сервису. Хотя бы одно из двух есть.
   */
  action: IntegrationAction | null;
  /** Настроенный сервис сломан, работа стоит: единственное предупреждение страницы. */
  blocksWork: boolean;
}>;

export type IntegrationAction = Readonly<{
  handoff: string | null;
  link: Readonly<{ label: string; href: string }> | null;
}>;

type AmoBlockedReason = keyof typeof settingsStatusWords.amoBlocked;

export type SettingsAmoAvailability =
  | Readonly<{ status: "ready" }>
  | Readonly<{ status: "blocked"; reason: AmoBlockedReason }>;

export type SettingsIntegrationFacts = Readonly<{
  waha: Readonly<{
    display: ProviderDisplayStatus;
    /** Статус сессии из чтения; нужен только для заблокированной. */
    sessionStatus: string | undefined;
    /** Когда состояние сессии наблюдалось; null — строки состояния нет. */
    observedAt: string | null;
  }>;
  gemini: ProviderDisplayStatus;
  amo: SettingsAmoAvailability;
}>;

export type SettingsDatabaseFact = Readonly<{
  /** Автоматическая проверка включена и запускалась при этом чтении. */
  checked: boolean;
  status: PlatformComponentStatus;
  /** «Данные на … (Бишкек).» — время проверки. */
  observed: string;
}>;

/** Не настраивали: выключено или нет параметров. Настроено и сломано — не сюда. */
const AMO_UNUSED: ReadonlySet<AmoBlockedReason> = new Set([
  "feature_disabled",
  "configuration_missing",
]);

const WHATSAPP_WITHOUT = "Входящие WhatsApp не приходят в CRM, ответить отсюда нельзя";
/** Страница WhatsApp: там видно то же состояние, что у сотрудников. */
const OPEN_WHATSAPP = { label: "Открыть WhatsApp", href: "/v3/inbox" } as const;
/** Работа на сервере — у технического специалиста. */
const handoff = (work: string): IntegrationAction => ({ handoff: `Передать техническому специалисту: ${work}`, link: null });
const FIX_PARAMETERS = handoff("исправить параметры на сервере");

/** «26.09 12:00» по Бишкеку; год двумя цифрами — только если он не текущий. */
export function formatSettingsCheck(value: string | null, now: Date): string | null {
  const parsed = value ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.valueOf()) || !Number.isFinite(now.valueOf())) return null;
  const parts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const at = parts(parsed);
  const year = at.year === parts(now).year ? "" : `.${at.year}`;
  return `${at.day}.${at.month}${year} ${at.hour}:${at.minute}`;
}

function whatsappRow(waha: SettingsIntegrationFacts["waha"], now: Date): IntegrationRow {
  const checked = { checkedAt: waha.observedAt, checkedText: formatSettingsCheck(waha.observedAt, now), checkable: true };
  if (waha.display === "ready") {
    return {
      key: "whatsapp", name: "WhatsApp", state: "подключён", tone: "ok", detail: null, ...checked,
      without: null, action: { handoff: null, link: OPEN_WHATSAPP }, blocksWork: false,
    };
  }
  if (waha.display === "blocked") {
    return {
      key: "whatsapp", name: "WhatsApp", state: "заблокирован", tone: "blocked",
      detail: settingsBlockedWahaDetail(waha.sessionStatus), ...checked,
      without: WHATSAPP_WITHOUT,
      action: { ...handoff("проверить подключение на сервере"), link: OPEN_WHATSAPP }, blocksWork: true,
    };
  }
  // Строки состояния нет: WhatsApp к CRM не подключали (вебхук снят 26.09
  // сознательно). Это не просьба подключить, а кто подключает, когда решат.
  return {
    key: "whatsapp", name: "WhatsApp", state: settingsStatusWords.notConnected, tone: "off", detail: null, ...checked,
    without: WHATSAPP_WITHOUT,
    action: { handoff: "Подключает технический специалист на сервере: вебхук и вход по QR", link: OPEN_WHATSAPP }, blocksWork: false,
  };
}

function geminiRow(display: ProviderDisplayStatus): IntegrationRow {
  const base = { key: "gemini", name: "Gemini · черновики ответов", checkedAt: null, checkedText: null, checkable: false } as const;
  if (display === "configured_not_verified") {
    return {
      ...base, state: "настроен, не проверен", tone: "warn", detail: null,
      without: "Черновики ответов могут не появляться", action: handoff("проверить работу сервиса на сервере"), blocksWork: false,
    };
  }
  if (display === "blocked") {
    return {
      ...base, state: "заблокирован", tone: "blocked", detail: "Параметры подключения некорректны.",
      without: "Черновики ответов AI не создаются", action: FIX_PARAMETERS, blocksWork: true,
    };
  }
  if (display === "ready") {
    return { ...base, state: "готов", tone: "ok", detail: null, without: null, action: null, blocksWork: false };
  }
  return {
    ...base, state: settingsStatusWords.unused, tone: "off", detail: null,
    without: "Черновики ответов AI не предлагаются", action: null, blocksWork: false,
  };
}

function amoRow(amo: SettingsAmoAvailability): IntegrationRow {
  const base = { key: "amocrm", name: "amoCRM", checkedAt: null, checkedText: null, checkable: false } as const;
  if (amo.status === "ready") {
    return {
      ...base, state: "настроена, не проверена", tone: "warn", detail: null,
      without: "Синхронизация может не выполняться", action: handoff("проверить синхронизацию на сервере"), blocksWork: false,
    };
  }
  if (AMO_UNUSED.has(amo.reason)) {
    return {
      ...base, state: settingsStatusWords.unused, tone: "off", detail: null,
      without: "Лиды не синхронизируются с amoCRM", action: null, blocksWork: false,
    };
  }
  return {
    ...base, state: "заблокирована", tone: "blocked", detail: settingsStatusWords.amoBlocked[amo.reason],
    without: "Синхронизация с amoCRM не выполняется", action: FIX_PARAMETERS, blocksWork: true,
  };
}

/** Строки таблицы «Интеграции»: WhatsApp, amoCRM, Gemini — в этом порядке. */
export function settingsIntegrations(facts: SettingsIntegrationFacts, now: Date): readonly IntegrationRow[] {
  return [whatsappRow(facts.waha, now), amoRow(facts.amo), geminiRow(facts.gemini)];
}

/** Сервисы, из-за которых работа стоит: имена для одного предупреждения сверху. */
export function settingsBlockingIntegrations(rows: readonly IntegrationRow[]): readonly IntegrationRow[] {
  return rows.filter((row) => row.blocksWork);
}

/** Слово о базе данных: без проверки — «не проверялось», без времени проверки. */
export function databaseFact(database: SettingsDatabaseFact): string {
  return database.checked
    ? `${settingsStatusWords.database[database.status]} · ${database.observed}`
    : settingsStatusWords.notChecked;
}
