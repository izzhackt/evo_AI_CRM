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

/**
 * Чем кончилось чтение журнала (Э8.11). `disabled` — показ журнала выключен
 * на сервере (`EVO_PLATFORM_P7A_AUDIT_ENABLED`); `unavailable` — чтение
 * включено, но не удалось. Ни то, ни другое не «ноль событий».
 */
export type JournalStatus = "ready" | "disabled" | "unavailable";

export type JournalNotice = Readonly<{
  text: string;
  /** Вторая строка: кто и что делает; null — её нет. */
  detail: string | null;
  /** «Повторить» — только у сбоя чтения. */
  retry: boolean;
}>;

/**
 * Что говорит список событий вместо строк; null — строки есть. Выключенный
 * или недоступный журнал не притворяется пустым, а «По этому фильтру событий
 * нет» — только когда фильтр действительно выбран. Записи аудита база ведёт
 * без этого флага: он выключает только показ и выгрузку, поэтому текст не
 * говорит, что события не записываются.
 */
export function journalNotice(
  status: JournalStatus,
  filters: JournalFilters,
  eventCount: number,
): JournalNotice | null {
  if (status === "disabled") {
    return {
      text: "Журнал выключен на сервере — события здесь не показываются.",
      detail: "Передать техническому специалисту: включить журнал на сервере.",
      retry: false,
    };
  }
  if (status === "unavailable") {
    return { text: "Журнал недоступен.", detail: "Не удалось прочитать события.", retry: true };
  }
  if (eventCount > 0) return null;
  return {
    text: normalizeJournalFilters(filters).objectType ? "По этому фильтру событий нет." : "Событий пока нет.",
    detail: null,
    retry: false,
  };
}
