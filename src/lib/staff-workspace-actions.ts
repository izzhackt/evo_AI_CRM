"use server";
import { revalidatePath } from "next/cache";
import { changeStaffDepartment, changeStaffMember, requestStaffAuth, saveStaffOrganizationalDetails, StaffMetadataOutcomeUnknownError, staffWorkspaceError } from "./server/staff-workspace-service";
import { staffAuthRejectionMessage, type StaffWorkspaceActionState } from "./v3/staff-workspace-contract";

export async function staffAuthAction(_previous: StaffWorkspaceActionState, form: FormData): Promise<StaffWorkspaceActionState> {
  try {
    const result = await requestStaffAuth(form);
    revalidatePath("/v3/settings");
    if (result.status === "rejected") return {
      status: "error", retryAllowed: true,
      message: `${staffAuthRejectionMessage(result.rejection_code)} Отправка не подтверждена, изменений в Auth не обнаружено. После устранения причины можно явно отправить новый запрос.`,
    };
    return result.status === "completed"
      ? { status: "success", message: result.operation === "invite"
        ? "Приглашение зарегистрировано в сервисе входа, доступ сотрудника создан. Доставка письма и первый вход пока не подтверждены."
        : "Запрос восстановления зарегистрирован в сервисе входа. Доставка письма пока не подтверждена." }
      : { status: "error", message: "Результат требует сверки. Откройте журнал запросов и нажмите «Проверить». Повторное письмо не отправляется." };
  } catch (error) {
    revalidatePath("/v3/settings");
    return { status: "error", message: staffWorkspaceError(error) };
  }
}

export async function staffMemberAction(_previous: StaffWorkspaceActionState, form: FormData): Promise<StaffWorkspaceActionState> {
  try {
    await changeStaffMember(form);
    revalidatePath("/v3/settings");
    return { status: "success", message: "Изменение сохранено. Прежние права сотрудника отозваны; для продолжения ему может потребоваться повторный вход." };
  } catch (error) {
    return { status: "error", message: staffWorkspaceError(error) };
  }
}

export async function staffDepartmentAction(_previous: StaffWorkspaceActionState, form: FormData): Promise<StaffWorkspaceActionState> {
  let confirmed = false;
  try {
    await changeStaffDepartment(form);
    confirmed = true;
    revalidatePath("/v3/settings");
    return { status: "success", message: "Отдел сохранён." };
  } catch (error) {
    if (_previous.metadataOutcome === "unknown" || confirmed || error instanceof StaffMetadataOutcomeUnknownError) return {
      status: "error", metadataOutcome: "unknown",
      message: "Результат сохранения пока не подтверждён. Нажмите «Проверить сохранение»: повторится тот же запрос без дублирования изменения.",
    };
    return { status: "error", message: staffWorkspaceError(error) };
  }
}

export async function staffOrganizationalDetailsAction(_previous: StaffWorkspaceActionState, form: FormData): Promise<StaffWorkspaceActionState> {
  let confirmed = false;
  try {
    await saveStaffOrganizationalDetails(form);
    confirmed = true;
    revalidatePath("/v3/settings");
    return { status: "success", message: "Рабочие сведения сохранены. Права доступа не изменены." };
  } catch (error) {
    if (_previous.metadataOutcome === "unknown" || confirmed || error instanceof StaffMetadataOutcomeUnknownError) return {
      status: "error", metadataOutcome: "unknown",
      message: "Результат сохранения пока не подтверждён. Нажмите «Проверить сохранение»: повторится тот же запрос без дублирования изменения.",
    };
    return { status: "error", message: staffWorkspaceError(error) };
  }
}
