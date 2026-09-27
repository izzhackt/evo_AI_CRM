export type {
  GateFacts,
  IntegrationRow,
  JournalEntry,
} from "@/lib/v3/settings-source";

/**
 * Разделы настроек — один список (Э6, 27.09.2026). Маршрут только для Admin
 * (`admin.preview`), поэтому пометок «виден только администратору» нет:
 * другой роли страница не открывается вовсе. «Сотрудники», «Роли и доступ» и
 * «Отделы» — пункты этого же списка с прежними адресами
 * `?section=staff&view=…`: второго уровня вкладок нет. Страница открывается
 * на «Сотрудниках». Прежний раздел «Состояние» стал таблицей «Интеграции»
 * (`?section=state` ведёт туда).
 */
export type StaffView = "people" | "roles" | "departments";

export const SECTIONS = [
  { key: "staff", view: "people", title: "Сотрудники" },
  { key: "staff", view: "roles", title: "Роли и доступ" },
  { key: "staff", view: "departments", title: "Отделы" },
  { key: "integrations", view: null, title: "Интеграции" },
  { key: "journal", view: null, title: "Журнал действий" },
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
