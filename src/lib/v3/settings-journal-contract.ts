import { PLATFORM_AUDIT_RESOURCE_TYPES } from "../platform-audit.ts";

/**
 * Фильтр журнала — только тип объекта. Фильтр по актору здесь был и снят:
 * аудит-API не умеет фильтровать по актору на сервере, а клиентский отбор
 * поверх серверной страницы честно не работает — страница из 60 строк без
 * искомой роли утверждала бы «событий нет» про журнал, где они есть.
 */
export type JournalFilters = Readonly<{
  objectType?: string;
}>;

function isAuditResourceType(
  value: string | undefined,
): value is (typeof PLATFORM_AUDIT_RESOURCE_TYPES)[number] {
  return value !== undefined && (PLATFORM_AUDIT_RESOURCE_TYPES as readonly string[]).includes(value);
}

export function normalizeJournalFilters(filters: JournalFilters): JournalFilters {
  return {
    ...(isAuditResourceType(filters.objectType)
      ? { objectType: filters.objectType }
      : {}),
  };
}
