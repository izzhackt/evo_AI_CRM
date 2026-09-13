"use server";

import { revalidatePath } from "next/cache";
import { executeStaffRoleCommand, StaffRoleOutcomeUnknownError } from "@/lib/server/staff-roles-service";
import { staffWorkspaceError } from "@/lib/server/staff-workspace-service";
import type { StaffRolesActionState } from "@/lib/v3/staff-roles-contract";

export async function staffRolesAction(previous: StaffRolesActionState, form: FormData): Promise<StaffRolesActionState> {
  let confirmed = false;
  try {
    const result = await executeStaffRoleCommand(form);
    if ("archiveImpact" in result) return { status: "success", message: "Проверьте изменение доступа перед архивированием.", archiveImpact: result.archiveImpact };
    if ("impact" in result) return { status: "success", message: "Проверьте изменение доступа перед публикацией.", impact: result.impact };
    confirmed = true;
    revalidatePath("/v3/settings");
    return { status: "success", message: form.get("operation") === "save" || form.get("operation") === "create" || form.get("operation") === "copy"
      ? "Черновик роли сохранён. Для изменения доступа опубликуйте его." : "Изменение доступа сохранено.", ...result };
  } catch (error) {
    if (previous.outcome === "unknown" || confirmed || error instanceof StaffRoleOutcomeUnknownError) return {
      status: "error", outcome: "unknown", message: "Результат пока не подтверждён. Проверьте сохранение тем же запросом; не создавайте новое изменение.",
    };
    const message = error instanceof Error ? error.message : "";
    return { status: "error", message: message.includes("confirmation_required")
      ? "Подтвердите, что проверили изменение доступа сотрудников."
      : message.includes("archive_requires_resolution") || message.includes("invalid_replacement")
        ? "Выберите опубликованную роль-замену либо подтвердите снятие назначений без замены."
      : message.includes("scope") ? "Область не подходит выбранной роли. Проверьте отдел, направление и разрешения."
      : message.includes("invalid_contract") ? "Не удалось подтвердить данные ролей. Обновите страницу; если ошибка повторится, сообщите администратору."
      : staffWorkspaceError(error) };
  }
}
