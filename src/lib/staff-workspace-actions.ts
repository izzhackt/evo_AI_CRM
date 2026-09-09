"use server";
import { revalidatePath } from "next/cache";
import { changeStaffMember, requestStaffAuth, staffWorkspaceError } from "./server/staff-workspace-service";
import type { StaffWorkspaceActionState } from "./v3/staff-workspace-contract";

export async function staffAuthAction(_previous: StaffWorkspaceActionState, form: FormData): Promise<StaffWorkspaceActionState> {
  try {
    const result = await requestStaffAuth(form);
    revalidatePath("/v3/settings");
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
