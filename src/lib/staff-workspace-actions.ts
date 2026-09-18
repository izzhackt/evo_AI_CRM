"use server";
import { revalidatePath } from "next/cache";
import { changeStaffDepartment, changeStaffMember, requestStaffAuth, readStaffAuthPreparation, prepareStaffPendingAccess,
  saveStaffOrganizationalDetails, StaffAuthOutcomeUnknownError, StaffCommandVersionRejectedError, StaffMetadataOutcomeUnknownError, staffWorkspaceError } from "./server/staff-workspace-service";
import { STAFF_UUID, staffAuthRejectionMessage, type StaffWorkspaceActionState } from "./v3/staff-workspace-contract";

function requestIdFrom(form: FormData): string | undefined {
  const value = form.get("request_id");
  return typeof value === "string" && STAFF_UUID.test(value) ? value.toLowerCase() : undefined;
}
function unknownAuthOutcome(requestId?: string): StaffWorkspaceActionState {
  return { status: "error", outcome: "unknown", requestId,
    message: "Результат требует сверки. Откройте этот запрос в журнале и нажмите «Проверить». Создание аккаунта или отправка письма повторно не выполняются." };
}

export async function staffAuthAction(_previous: StaffWorkspaceActionState, form: FormData): Promise<StaffWorkspaceActionState> {
  let confirmedRequestId: string | undefined;
  try {
    const result = await requestStaffAuth(form);
    confirmedRequestId = result.requestId;
    revalidatePath("/v3/settings");
    if (result.status === "rejected") return {
      status: "error", retryAllowed: true, requestId: result.requestId,
      message: `${staffAuthRejectionMessage(result.rejectionCode)} Изменений в Auth не обнаружено. После устранения причины можно явно создать новый запрос.`,
    };
    return result.status === "completed"
      ? { status: "success", requestId: result.requestId, ...(result.oneTimePassword ? { oneTimePassword: result.oneTimePassword } : {}),
        message: result.operation === "password"
        ? result.oneTimePassword
          ? "Аккаунт создан с выбранными правами. Сохраните пароль: он показывается только сейчас."
          : "Аккаунт создан. Первоначальный пароль повторно не показывается; если он не был сохранён, используйте восстановление входа."
        : result.operation === "invite"
        ? "Приглашение зарегистрировано в сервисе входа, аккаунт подключён с подтверждёнными настройками доступа. Доставка письма и первый вход пока не подтверждены."
        : "Запрос восстановления зарегистрирован в сервисе входа. Доставка письма пока не подтверждена." }
      : { ...unknownAuthOutcome(result.requestId), ...(result.conflictCode ? { conflictCode: result.conflictCode } : {}) };
  } catch (error) {
    if (error instanceof StaffAuthOutcomeUnknownError || confirmedRequestId || _previous.outcome === "unknown") {
      return unknownAuthOutcome(error instanceof StaffAuthOutcomeUnknownError ? error.requestId : confirmedRequestId ?? _previous.requestId ?? requestIdFrom(form));
    }
    return { status: "error", message: staffWorkspaceError(error) };
  }
}

export async function staffAuthPreparationAction(_previous: StaffWorkspaceActionState, form: FormData): Promise<StaffWorkspaceActionState> {
  try {
    const preparation = await readStaffAuthPreparation(form);
    return { status: "success", message: "Сохранённые настройки запроса загружены.", preparation,
      requestId: preparation.requestId, ...(preparation.conflictCode ? { conflictCode: preparation.conflictCode } : {}) };
  } catch (error) {
    return { status: "error", message: staffWorkspaceError(error), requestId: requestIdFrom(form) };
  }
}

export async function staffPreparePendingAccessAction(_previous: StaffWorkspaceActionState, form: FormData): Promise<StaffWorkspaceActionState> {
  let confirmedRequestId: string | undefined;
  try {
    const result = await prepareStaffPendingAccess(form);
    confirmedRequestId = result.requestId;
    const preparation = await readStaffAuthPreparation(form);
    revalidatePath("/v3/settings");
    return { status: "success", requestId: result.requestId, preparation,
      message: "Настройки запроса сохранены. Нажмите «Проверить», чтобы сверить приглашение. Повторное письмо не отправлялось." };
  } catch (error) {
    if (error instanceof StaffCommandVersionRejectedError && !confirmedRequestId) {
      return { status: "error", message: staffWorkspaceError(error), requestId: requestIdFrom(form) };
    }
    if (error instanceof StaffAuthOutcomeUnknownError || confirmedRequestId || _previous.outcome === "unknown") {
      return unknownAuthOutcome(error instanceof StaffAuthOutcomeUnknownError ? error.requestId : confirmedRequestId ?? _previous.requestId ?? requestIdFrom(form));
    }
    return { status: "error", message: staffWorkspaceError(error), requestId: requestIdFrom(form) };
  }
}

export async function staffMemberAction(_previous: StaffWorkspaceActionState, form: FormData): Promise<StaffWorkspaceActionState> {
  let confirmedRequestId: string | undefined;
  try {
    const result = await changeStaffMember(form);
    confirmedRequestId = result.requestId;
    revalidatePath("/v3/settings");
    return { status: "success", requestId: result.requestId, message: "Статус сотрудника сохранён. Изменение доступа действует сразу." };
  } catch (error) {
    if (error instanceof StaffCommandVersionRejectedError && !confirmedRequestId) {
      return { status: "error", message: staffWorkspaceError(error), requestId: requestIdFrom(form) };
    }
    if (error instanceof StaffAuthOutcomeUnknownError || confirmedRequestId || _previous.outcome === "unknown") return {
      status: "error", outcome: "unknown",
      requestId: error instanceof StaffAuthOutcomeUnknownError ? error.requestId : confirmedRequestId ?? _previous.requestId ?? requestIdFrom(form),
      message: "Состояние сотрудника требует проверки. Сохраните этот запрос и обновите сведения; не создавайте повторное изменение вслепую.",
    };
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
    return { status: "success", message: "Рабочие сведения сохранены." };
  } catch (error) {
    if (_previous.metadataOutcome === "unknown" || confirmed || error instanceof StaffMetadataOutcomeUnknownError) return {
      status: "error", metadataOutcome: "unknown",
      message: "Результат сохранения пока не подтверждён. Нажмите «Проверить сохранение»: повторится тот же запрос без дублирования изменения.",
    };
    return { status: "error", message: staffWorkspaceError(error) };
  }
}
