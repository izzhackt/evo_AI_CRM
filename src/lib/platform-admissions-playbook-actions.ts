"use server";

import { requirePlatformStaffActor } from "./platform-guards";
import { admissionsCommandRpc, parseAdmissionsCommand, type AdmissionsCommandResult } from "./platform-admissions-playbook-command";
import { admissionsRpc, AdmissionsSourceError, normalizeAdmissionsReceipt } from "./v3/admissions-source";

function failure(code: Extract<AdmissionsCommandResult, { ok: false }>["code"]): AdmissionsCommandResult {
  const messages = {
    invalid: "Проверьте поля и подтверждения этапа. Неизвестные или неполные данные не позволяют выполнить действие.",
    stale: "Дело изменено в другой вкладке. Ваш ввод остался на экране. Сверьте данные перед повтором.",
    denied: "Нет доступа к изменению этого дела. Проверьте назначение куратора и состояние дела.",
    request_conflict: "Этот запрос уже использован для других данных. Обновите дело перед новым действием.",
    unavailable: "Не удалось подтвердить сохранение. Не меняйте данные запроса: повторите его, чтобы проверить результат.",
  };
  return { ok: false, code, message: messages[code] };
}

export async function executeAdmissionsCommandAction(input: unknown): Promise<AdmissionsCommandResult> {
  const actor = await requirePlatformStaffActor();
  if (actor.authorityRole === "sales" || actor.presentationRole === "sales") return failure("denied");
  const command = parseAdmissionsCommand(input);
  if (!command) return failure("invalid");
  try {
    const rpc = admissionsCommandRpc(command);
    const data = await admissionsRpc(rpc.name, rpc.args);
    const receipt = normalizeAdmissionsReceipt(data, { caseId: command.caseId, requestId: command.requestId,
      ...(command.operation === "application" ? { applicationId: command.applicationId } : {}),
      ...(command.operation === "visa" ? { visaCaseId: command.visaCaseId } : {}),
    });
    // The client keeps the confirmed receipt and then explicitly reloads this
    // force-dynamic view. An RSC refresh must not erase an uncertain command.
    return { ok: true, receipt };
  } catch (error) { return failure(error instanceof AdmissionsSourceError ? error.code : "unavailable"); }
}
