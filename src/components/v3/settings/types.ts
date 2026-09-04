export type {
  GateFacts,
  Health,
  Integration,
  JournalEntry,
  RoleRow,
} from "@/lib/v3/settings-source";

/**
 * Разделы настроек.
 *
 * `admin: true` — раздел виден только администратору. Журнал действий и
 * состояние платформы к работе продаж и приёмной отношения не имеют, а журнал
 * ещё и показывает чужие действия.
 */
export const SECTIONS = [
  { key: "state", title: "Состояние", admin: false },
  { key: "integrations", title: "Интеграции", admin: false },
  { key: "journal", title: "Журнал действий", admin: true },
  { key: "access", title: "Роли и доступ", admin: false },
  { key: "documents", title: "Документы и гейты", admin: false },
  { key: "platform", title: "Платформа", admin: true },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

export function isSectionKey(value: unknown): value is SectionKey {
  return SECTIONS.some((s) => s.key === value);
}
