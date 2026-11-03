export type {
  GateFacts,
  IntegrationRow,
  JournalEntry,
} from "@/lib/v3/settings-source";

/**
 * Разделы настроек — один список (Э6, 27.09.2026). Маршрут для Admin
 * (`admin.preview`), поэтому пометок «виден только администратору» нет:
 * другой роли страница не открывается вовсе. Единственное исключение — раздел
 * «Телефония» (срез T4b телефонии): держатель `telephony.manage` («Телефония —
 * руководитель») открывает страницу и видит только его. «Сотрудники», «Роли и доступ» и
 * «Отделы» — пункты этого же списка с прежними адресами
 * `?section=staff&view=…`: второго уровня вкладок нет. Страница открывается
 * на «Сотрудниках». Прежний раздел «Состояние» стал таблицей «Интеграции»
 * (`?section=state` ведёт туда). «Отчёты» (миграция 323, 27.10.2026) — ссылки на
 * отчёты Looker Studio для «Маркетинга» и «Финансов», стоят после «Телефонии»:
 * «Телефония» остаётся сразу после «Интеграций».
 */
export type StaffView = "people" | "roles" | "departments";

export const SECTIONS = [
  { key: "staff", view: "people", title: "Сотрудники" },
  { key: "staff", view: "roles", title: "Роли и доступ" },
  { key: "staff", view: "departments", title: "Отделы" },
  { key: "integrations", view: null, title: "Интеграции" },
  { key: "telephony", view: null, title: "Телефония" },
  { key: "reports", view: null, title: "Отчёты" },
  { key: "journal", view: null, title: "Журнал действий" },
  { key: "deletion", view: null, title: "Запросы на удаление" },
  { key: "documents", view: null, title: "Документы и передача" },
  { key: "platform", view: null, title: "Платформа" },
] as const satisfies readonly Readonly<{ key: string; view: StaffView | null; title: string }>[];

export type SectionKey = (typeof SECTIONS)[number]["key"];

export function isSectionKey(value: unknown): value is SectionKey {
  return SECTIONS.some((s) => s.key === value);
}

export function staffViewOf(value: unknown): StaffView {
  return value === "departments" ? "departments" : value === "roles" ? "roles" : "people";
}

/** Разделы, которые видит сотрудник без прав Admin, но с `telephony.manage`: один — «Телефония». */
export const TELEPHONY_ONLY_SECTIONS = SECTIONS.filter((entry) => entry.key === "telephony");
