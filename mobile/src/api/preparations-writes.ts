// Записи раздела «Требования и документы программы». Каждая несёт клиентский `requestId` и идемпотентна по нему: повтор после
// обрыва шлёт ТОТ ЖЕ запрос с теми же аргументами, новый id при повторе не создаётся (`lib/rpc.ts`, инвариант 2).
// Ответ сервера принимается только как точная квитанция общего разборщика веба; всё прочее - «результат неизвестен»
// (`unavailable`), а запрос остаётся у вызывающего для повтора. Выдуманного успеха нет.
import {
  applicationRequirementsFailure,
  applicationRequirementsRpcArgs,
  parseApplicationRequirementsIntent,
  parseApplicationRequirementsReceipt,
  type ApplicationRequirementsActionResult,
} from "@web/lib/portal/application-requirements";

import { callRpc, failureForParser } from "@/api/preparations-rpc";
import type { RpcTransport } from "@/lib/rpc";

/** Сколько раз тот же запрос повторяется сам при обрыве связи (как у `rpcWrite`). */
const RETRIES = 2;

/**
 * «Открыть список документов»: `student_initialize_application_requirements_v1`. Принимает замороженный запрос
 * (`studentCaseId`, `applicationId`, `requestId`). Результат тот же, что у серверного действия веба: при любой
 * неудаче вместе с причиной возвращается тот же запрос, чтобы вызывающий мог повторить его, не меняя `requestId`.
 */
export async function initializeApplicationRequirements(
  transport: RpcTransport,
  value: unknown,
  options: Readonly<{ wait?: (attempt: number) => Promise<void> }> = {},
): Promise<ApplicationRequirementsActionResult> {
  const intent = parseApplicationRequirementsIntent(value);
  if (!intent) return { ok: false, reason: "invalid", intent: null };
  const outcome = await callRpc(transport, "student_initialize_application_requirements_v1", applicationRequirementsRpcArgs(intent), {
    retries: RETRIES,
    wait: options.wait,
  });
  if (!outcome.ok) {
    // Ответа не было: запись могла дойти, результат неизвестен.
    const reason = outcome.transport ? "unavailable" : applicationRequirementsFailure(failureForParser(outcome.failure));
    return { ok: false, reason, intent };
  }
  const receipt = parseApplicationRequirementsReceipt(outcome.data, intent);
  return receipt ? { ok: true, receipt } : { ok: false, reason: "unavailable", intent };
}
