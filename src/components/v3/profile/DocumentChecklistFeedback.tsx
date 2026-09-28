"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { PlatformDocumentChecklistActionState } from "@/lib/platform-document-checklist-actions";

/** Итог команды чек-листа словами (создать, изменить, убрать, связать, базовый чек-лист). */
export function checklistMessage(status: PlatformDocumentChecklistActionState["status"]): string | null {
  switch (status) {
    case "idle":
      return null;
    case "saved":
      return "Чек-лист сохранён.";
    case "invalid":
      return "Проверьте название и группу документа.";
    case "forbidden":
      return "У этой роли нет права изменять чек-лист.";
    case "stale":
      return "Пункт уже изменён другим сотрудником. Обновите страницу.";
    case "request_conflict":
      return "Эта команда уже использована с другими данными. Обновите страницу.";
    case "unavailable":
      return "База не подтвердила изменение. Чек-лист не изменён.";
  }
}

export function ChecklistFeedback({
  state,
}: Readonly<{ state: Readonly<{ status: PlatformDocumentChecklistActionState["status"] }> }>) {
  const message = checklistMessage(state.status);
  if (!message) return null;
  return (
    <p
      className={state.status === "saved" ? "t-body-compact text-ok" : "t-body-compact text-danger"}
      role="status"
      data-testid="v3-document-checklist-status"
      data-outcome={state.status}
    >
      {message}
    </p>
  );
}

/** Сохранено — страница перечитывает чек-лист: чтение сервера остаётся источником правды. */
export function useRefreshAfterSave(status: PlatformDocumentChecklistActionState["status"]) {
  const router = useRouter();
  useEffect(() => {
    if (status === "saved") router.refresh();
  }, [router, status]);
}
