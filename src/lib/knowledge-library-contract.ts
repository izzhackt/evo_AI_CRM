export const KNOWLEDGE_AREAS = ["internal", "clients", "raw", "secrets"] as const;
export type KnowledgeArea = (typeof KNOWLEDGE_AREAS)[number];
export type KnowledgeKind = "folder" | "page" | "file" | "secret";
export const KNOWLEDGE_PART_SIZE = 8 * 1024 * 1024;
export const KNOWLEDGE_AREA_NAMES: Record<KnowledgeArea, string> = {
  internal: "Внутренняя база EVO", clients: "Клиентская база", raw: "Сырой архив", secrets: "Секреты и доступы",
};
export type KnowledgeItem = {
  id: string; organization_id: string; area: KnowledgeArea; parent_id: string | null;
  kind: KnowledgeKind; title: string; body?: string; description: string;
  client_case_id: string | null; blob_id: string | null; source_blob_id: string | null;
  mime_type: string; source?: Record<string, unknown>; source_key: string | null;
  review_question: string; version: number; archived_at: string | null; deleted_at: string | null;
  created_at: string; updated_at: string; updated_by: string;
};
export type KnowledgePage = { items: KnowledgeItem[]; hasMore: boolean; nextCursor: { title: string; id: string } | null };
export type KnowledgeVersion = { version: number; created_at: string; actor_membership_id: string; snapshot: KnowledgeItem };
export type KnowledgeBlob = {
  id: string; organization_id: string; area: KnowledgeArea; sha256: string; byte_size: number;
  part_size: number; state: "uploading" | "ready"; owner_membership_id: string;
  scan_status?: "pending" | "clean" | "opaque";
  parts?: { part_index: number; byte_size: number; sha256: string }[];
};
export type KnowledgeQuery = {
  mode?: "list" | "search" | "folders" | "trash" | "review" | "archive" | "inbox";
  area?: KnowledgeArea; parentId?: string | null; caseId?: string; search?: string;
  afterTitle?: string; afterId?: string; limit?: number;
};
export type KnowledgeCommand = Record<string, unknown> & { op: string };
export const KNOWLEDGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const KNOWLEDGE_SHA256 = /^[0-9a-f]{64}$/;

export function knowledgeMessage(code: string): string {
  const messages: Record<string, string> = {
    knowledge_forbidden: "База знаний доступна только администратору.",
    authentication_required: "Войдите в CRM и повторите действие.",
    knowledge_version_conflict: "Материал изменён в другой вкладке. Ваш текст сохранён в редакторе. Откройте текущую версию перед повторным сохранением.",
    knowledge_request_conflict: "Этот запрос уже выполнен с другими параметрами. Обновите материал.",
    knowledge_not_found: "Материал не найден.",
    knowledge_parent_invalid: "Выберите доступную папку.",
    knowledge_folder_cycle: "Нельзя переместить папку внутрь неё самой.",
    knowledge_case_boundary: "Папка принадлежит другому клиенту.",
    knowledge_blob_not_ready: "Загрузка файла ещё не проверена. Повторите проверку.",
    knowledge_integrity_failed: "Байты файла не совпали с исходником. Повторите загрузку.",
    knowledge_in_trash: "Восстановите материал из корзины перед редактированием.",
    knowledge_sops_unavailable: "Хранилище доступов не подключено. Требуется ключ SOPS на сервере.",
  };
  return messages[code] ?? "Действие не выполнено. Повторите попытку; несохранённый текст остаётся в редакторе.";
}
