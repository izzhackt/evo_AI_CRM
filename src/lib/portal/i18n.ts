/**
 * Портальный словарный слой (PORT-2, дизайн-контракт
 * docs/design/portal/design-contract.md).
 *
 * Правила:
 * - Портал говорит на RU и KY. Каждый новый портальный текст обязан иметь
 *   обе версии: тип `Record<ключи ru, string>` ловит пропуск на typecheck,
 *   а tests/portal-i18n.test.mjs — на прогоне тестов. Тихого фолбэка на
 *   английский нет и не будет.
 * - `en` из существующего механизма локали (src/lib/i18n.ts, cookie `locale`)
 *   намеренно резолвится в RU: у портала нет английской версии интерфейса,
 *   и случайная английская строка хуже честной русской (план §7, тексты).
 * - Staff-словари (src/lib/i18n-data.ts DICTS, src/lib/v3/wording.ts) сюда
 *   не импортируются — изоляция от staff CRM по дизайн-контракту.
 */
import type { Locale } from "../i18n-data.ts";

const shellRu = {
  skipToContent: "Перейти к содержимому",
  home: "EVO Admissions — кабинет студента",
  notifications: "Уведомления",
  account: "Ваш аккаунт",
  logout: "Выйти",
  openingSection: "Открываем раздел «{label}»",
  "nav.overview": "Поступление",
  "nav.documents": "Документы",
  "nav.universities": "Университеты",
  "nav.payments": "Оплата",
  "nav.notifications": "Уведомления",
  "nav.tests": "Тесты",
} as const;

type ShellKey = keyof typeof shellRu;

const shellKy: Readonly<Record<ShellKey, string>> = {
  skipToContent: "Мазмунга өтүү",
  home: "EVO Admissions — студенттин кабинети",
  notifications: "Билдирмелер",
  account: "Сиздин аккаунт",
  logout: "Чыгуу",
  openingSection: "«{label}» бөлүмүн ачып жатабыз",
  "nav.overview": "Тапшыруу",
  "nav.documents": "Документтер",
  "nav.universities": "Университеттер",
  "nav.payments": "Төлөм",
  "nav.notifications": "Билдирмелер",
  "nav.tests": "Тесттер",
};

/** Все портальные словари, по неймспейсам. Экспорт — для контракт-теста. */
export const PORTAL_DICTIONARIES = {
  shell: { ru: shellRu, ky: shellKy },
} as const;

export type PortalNamespace = keyof typeof PORTAL_DICTIONARIES;

export type PortalStrings<N extends PortalNamespace> =
  (typeof PORTAL_DICTIONARIES)[N]["ru"];

/**
 * Строки неймспейса для локали. KY — полный словарь (пропуск ключа — ошибка
 * компиляции и теста), RU — базовый, EN — сознательно RU.
 */
export function getPortalStrings<N extends PortalNamespace>(
  namespace: N,
  locale: Locale,
): PortalStrings<N> {
  const dictionary = PORTAL_DICTIONARIES[namespace];
  return (locale === "ky" ? dictionary.ky : dictionary.ru) as PortalStrings<N>;
}

/** Подстановка значений в шаблон вида «Открываем раздел «{label}»». */
export function formatPortalString(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) =>
    Object.hasOwn(values, key) ? values[key] : match,
  );
}
