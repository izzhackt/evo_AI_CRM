import type { PlatformComponentStatus } from "../platform-observability.ts";
import type { ProviderDisplayStatus } from "../provider-display-status.ts";
import { settingsBlockedWahaDetail, settingsStatusWords } from "./wording.ts";

/**
 * «Настройки → Состояние и Интеграции» из уже прочитанных фактов, без чтений.
 *
 * «Требует внимания» — только то, что настроено и сломано или ждёт проверки
 * (аудит 26.09): проверка, которая не запускалась, — «не проверялось», а
 * провайдер, которого просто не настраивали, — «не используется»; ни то ни
 * другое не тревога. WhatsApp без данных о подключении — честное «не
 * подключён»: пункт меню WhatsApp есть, значит, это недоделанная работа.
 */

export type Integration = Readonly<{
  name: string;
  state: string;
  ok: boolean;
  detail: string;
}>;

export type Health = Readonly<{
  name: string;
  state: string;
  detail: string;
  tone: "ok" | "warn" | "off";
  /** null — в «Требует внимания» не входит. */
  blocker: string | null;
  where: string | null;
}>;

type AmoBlockedReason = keyof typeof settingsStatusWords.amoBlocked;

export type SettingsAmoAvailability =
  | Readonly<{ status: "ready" }>
  | Readonly<{ status: "blocked"; reason: AmoBlockedReason }>;

export type SettingsHealthFacts = Readonly<{
  waha: Readonly<{
    display: ProviderDisplayStatus;
    /** Статус сессии из чтения; нужен только для заблокированной. */
    sessionStatus: string | undefined;
    /** «Данные на … (Бишкек).» — время чтения состояния сессии. */
    observed: string;
  }>;
  gemini: ProviderDisplayStatus;
  amo: SettingsAmoAvailability;
  database: Readonly<{
    /** Автоматическая проверка включена и запускалась при этом чтении. */
    checked: boolean;
    status: PlatformComponentStatus;
    observed: string;
  }>;
}>;

/** Не настраивали: выключено или нет параметров. Настроено и сломано — не сюда. */
const AMO_UNUSED: ReadonlySet<AmoBlockedReason> = new Set([
  "feature_disabled",
  "configuration_missing",
]);

export function wahaIntegration(facts: SettingsHealthFacts["waha"]): Integration {
  if (facts.display === "ready") {
    return { name: "WhatsApp", state: "готова", ok: true, detail: `Подключение подтверждено. ${facts.observed}` };
  }
  if (facts.display === "blocked") {
    return {
      name: "WhatsApp",
      state: "заблокирована",
      ok: false,
      detail: `${settingsBlockedWahaDetail(facts.sessionStatus)} ${facts.observed}`,
    };
  }
  return { name: "WhatsApp", state: settingsStatusWords.notConnected, ok: false, detail: "Нет данных о подключении." };
}

export function geminiIntegration(display: ProviderDisplayStatus): Integration {
  const name = "Gemini · предложения";
  if (display === "configured_not_verified") {
    return { name, state: "настроен, не проверен", ok: false, detail: "Работа сервиса ещё не проверена." };
  }
  if (display === "blocked") {
    return { name, state: "заблокирован", ok: false, detail: "Параметры подключения некорректны." };
  }
  return { name, state: settingsStatusWords.unused, ok: false, detail: "Подключение не настроено." };
}

export function amoIntegration(amo: SettingsAmoAvailability): Integration {
  if (amo.status === "ready") {
    return { name: "amoCRM", state: "настроена, не проверена", ok: false, detail: "Синхронизация ещё не проверена." };
  }
  return {
    name: "amoCRM",
    state: AMO_UNUSED.has(amo.reason) ? settingsStatusWords.unused : "заблокирована",
    ok: false,
    detail: settingsStatusWords.amoBlocked[amo.reason],
  };
}

/** Слово о базе данных: без проверки — «не проверялось», без времени проверки. */
export function databaseFact(database: SettingsHealthFacts["database"]): string {
  return database.checked
    ? `${settingsStatusWords.database[database.status]} · ${database.observed}`
    : settingsStatusWords.notChecked;
}

export function settingsHealth(facts: SettingsHealthFacts): readonly Health[] {
  const whatsapp = wahaIntegration(facts.waha);
  const gemini = geminiIntegration(facts.gemini);
  const amo = amoIntegration(facts.amo);
  const geminiUnused = facts.gemini === "not_configured";
  const amoUnused = facts.amo.status === "blocked" && AMO_UNUSED.has(facts.amo.reason);
  const { database } = facts;

  return [
    {
      name: "WhatsApp",
      state: whatsapp.state,
      detail: whatsapp.detail,
      tone: whatsapp.ok ? "ok" : "warn",
      blocker: whatsapp.ok ? null
        : facts.waha.display === "not_configured"
          ? "Нужно подключить WhatsApp к CRM."
          : "Нужна актуальная проверка подключения.",
      where: whatsapp.ok ? null : "platform.staff_waha_session_health",
    },
    {
      name: "Gemini · черновики ответов",
      state: gemini.state,
      detail: gemini.detail,
      tone: gemini.ok ? "ok" : geminiUnused ? "off" : "warn",
      blocker: gemini.ok || geminiUnused ? null
        : facts.gemini === "configured_not_verified"
          ? "Нужна проверка работы сервиса."
          : "Нужно проверить настройки подключения.",
      where: gemini.ok || geminiUnused ? null : "EVO_PLATFORM_GEMINI_API_KEY",
    },
    {
      name: "amoCRM",
      state: amo.state,
      detail: amo.detail,
      tone: amo.ok ? "ok" : amoUnused ? "off" : "warn",
      blocker: amo.ok || amoUnused ? null
        : facts.amo.status === "ready"
          ? "Нужна проверка синхронизации."
          : "Нужно проверить настройки синхронизации.",
      where: amo.ok || amoUnused ? null : "canonical amoCRM command readiness",
    },
    !database.checked
      ? {
          name: "База данных",
          state: settingsStatusWords.notChecked,
          detail: "Автоматическая проверка выключена.",
          tone: "off",
          blocker: null,
          where: null,
        }
      : {
          name: "База данных",
          state: settingsStatusWords.database[database.status],
          detail: database.observed,
          tone: database.status === "ready" ? "ok" : "warn",
          blocker: database.status === "ready" ? null : "Проверка подключения к базе данных не прошла.",
          where: database.status === "ready" ? null : "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED",
        },
  ];
}
