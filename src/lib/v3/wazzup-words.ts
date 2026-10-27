/**
 * WhatsApp через Wazzup в интерфейсе сотрудника (план Wazzup §8, срез W3): слова и правила без React и без сервера.
 * Их читают «Продажи → WhatsApp» (плашка канала), таблица «Настройки → Интеграции», карточка канала и Node-тесты.
 *
 * Слово состояния канала даёт `platform-wazzup-health.ts` (то же, что пишет таймер в серию 321): незнакомое слово
 * рабочим не считается. Номера канала здесь нет вовсе: максимум - четыре последние цифры, если функция чтения их отдаёт.
 */
import { wazzupStateHealthWord } from "../platform-wazzup-health.ts";
import type { PlatformWhatsAppTransport } from "../platform-whatsapp-transport.ts";

export type WazzupTone = "ok" | "warn" | "danger";

/** Одна строка в обоих местах: под лентой чата и в строке «WhatsApp · Wazzup» таблицы. */
export const WAZZUP_READ_ONLY_LINE = "Только чтение: отвечайте в amoCRM или Wazzup.";
export const WAZZUP_FALLBACK_LINE = "Запасной путь WAHA выключен, пока работает Wazzup.";
export const WAZZUP_INTAKE_OFF_LINE = "Приём сообщений выключен на сервере. Входящие не попадают в CRM.";
export const WAZZUP_TITLE = "WhatsApp продаж через Wazzup";

/** Слово серии 321 -> слово на экране (строчными: так читается в таблице) и тон. */
const STATE_WORDS: Readonly<Record<string, readonly [string, WazzupTone]>> = Object.freeze({
  WORKING: ["подключён", "ok"],
  STARTING: ["запускается", "warn"],
  SCAN_QR_CODE: ["ждёт QR-код", "warn"],
  PHONE_UNAVAILABLE: ["телефон недоступен", "warn"],
  OPEN_ELSEWHERE: ["открыт на другом устройстве", "warn"],
  WAIT_FOR_PASSWORD: ["ждёт пароль", "warn"],
  ON_MODERATION: ["на проверке", "warn"],
  NOT_PAID: ["тариф не оплачен", "danger"],
  UNAUTHORIZED: ["нужно подключить заново", "danger"],
  DISABLED: ["отключён", "danger"],
  FOREIGN_PHONE: ["подключён другой номер", "danger"],
  BLOCKED: ["номер заблокирован", "danger"],
  REJECTED: ["отклонён", "danger"],
});

export type WazzupChannelWords = Readonly<{ label: string; tone: WazzupTone; working: boolean }>;

/** Состояние канала словом. Нет слова (канал ещё не наблюдали) или оно незнакомо - не рабочий и не «сломанный». */
export function wazzupChannelWords(state: string | null): WazzupChannelWords {
  if (state === null) return Object.freeze({ label: "состояние не получено", tone: "warn", working: false });
  const word = wazzupStateHealthWord(state);
  const known = STATE_WORDS[word];
  if (known === undefined) return Object.freeze({ label: "состояние не распознано", tone: "warn", working: false });
  return Object.freeze({ label: known[0], tone: known[1], working: word === "WORKING" });
}

export const capitalizeRu = (word: string): string => word.charAt(0).toLocaleUpperCase("ru") + word.slice(1);

export const wazzupChannelKind = (transport: "whatsapp" | "wapi"): string =>
  transport === "wapi" ? "WABA (WhatsApp Business API)" : "Обычный WhatsApp";

/** Состояние плашки «Продажи → WhatsApp»: рабочий канал не объявляется (решение 07.10.2026). */
export type WazzupInboxChannelState = "ready" | "attention" | "unavailable" | "intake_off";

export function wazzupInboxChannelState(transport: PlatformWhatsAppTransport, intakeEnabled: boolean): WazzupInboxChannelState {
  if (transport.channel === null || transport.channel.state === null) return "unavailable";
  if (!wazzupChannelWords(transport.channel.state).working) return "attention";
  return intakeEnabled ? "ready" : "intake_off";
}

export type WazzupCardRow = Readonly<{ label: string; value: string }>;

/**
 * Строки карточки в «Настройках»: только то, чего нет в строке таблицы выше. Ключа, адреса вебхука и номера нет;
 * `formatTime` отдаёт вызывающий («27.10 14:05» по Бишкеку).
 */
export function wazzupCardRows(
  transport: PlatformWhatsAppTransport,
  intakeEnabled: boolean,
  formatTime: (iso: string | null) => string | null,
): readonly WazzupCardRow[] {
  const channel = transport.channel;
  const rows: WazzupCardRow[] = [];
  if (channel) rows.push({ label: "Тип", value: wazzupChannelKind(channel.transport) });
  if (channel?.last4) rows.push({ label: "Номер", value: `••••${channel.last4}` });
  rows.push({ label: "Последнее входящее", value: formatTime(transport.lastInboundAt) ?? "нет за 30 дней" });
  rows.push({ label: "Приём", value: intakeEnabled ? "включён" : "выключен на сервере" });
  rows.push({ label: "Ответы из EVO", value: "нет" });
  return Object.freeze(rows);
}
