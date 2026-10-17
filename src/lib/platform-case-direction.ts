/**
 * «Задать направление» делу студента - одна запись через
 * `platform.set_student_case_direction_v1` (миграция 292). Разбор ответа живёт в
 * platform-case-direction-contract.ts; здесь только вызов и честный исход.
 * Право, версия, регламент и идемпотентность решает SQL: проверки интерфейса -
 * подсказки, а не граница безопасности.
 */
import type { PlatformActor } from "./platform-auth";
import {
  caseDirectionStatusFromRpcError,
  normalizeCaseDirectionReceipt,
  parseCaseDirection,
  parseExpectedAdmissionsVersion,
  parseQueueUuid,
  type CaseDirectionReceipt,
  type CaseDirectionStatus,
} from "./platform-case-direction-contract.ts";
import type { AdmissionsDirection } from "./platform-admissions-playbook-contract.ts";

export * from "./platform-case-direction-contract.ts";

export class PlatformCaseDirectionError extends Error {
  readonly status: Exclude<CaseDirectionStatus, "saved" | "unchanged" | "preview">;

  constructor(status: Exclude<CaseDirectionStatus, "saved" | "unchanged" | "preview">) {
    super("Case direction update failed.");
    this.name = "PlatformCaseDirectionError";
    this.status = status;
  }
}

async function getPlatformClient() {
  if (typeof window !== "undefined") throw new PlatformCaseDirectionError("unavailable");
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export type SetStudentCaseDirectionCommand = Readonly<{
  studentCaseId: string;
  direction: AdmissionsDirection;
  expectedVersion: string;
  requestId: string;
}>;

/**
 * Одна запись. `unavailable` значит «исход неизвестен» (запись могла пройти):
 * вызывающий повторяет с ТЕМ ЖЕ идентификатором запроса, сервер вернёт
 * прежнюю расписку и не запишет второй раз.
 */
export async function setStudentCaseDirection(
  actor: PlatformActor,
  command: SetStudentCaseDirectionCommand,
): Promise<CaseDirectionReceipt> {
  const organizationId = parseQueueUuid(actor.organizationId);
  const studentCaseId = parseQueueUuid(command.studentCaseId);
  const requestId = parseQueueUuid(command.requestId);
  const expectedVersion = parseExpectedAdmissionsVersion(command.expectedVersion);
  const direction = parseCaseDirection(command.direction);
  if (!organizationId || !studentCaseId || !requestId || expectedVersion === null || direction === null) {
    throw new PlatformCaseDirectionError("invalid");
  }
  let response;
  try {
    const client = await getPlatformClient();
    response = await client.schema("platform").rpc("set_student_case_direction_v1", {
      p_organization_id: organizationId,
      p_student_case_id: studentCaseId,
      p_direction: direction,
      // Десятичный текст сохраняет весь диапазон bigint; PostgREST приводит его к BIGINT.
      p_expected_version: expectedVersion,
      p_request_id: requestId,
    });
  } catch {
    throw new PlatformCaseDirectionError("unavailable");
  }
  if (response.error) throw new PlatformCaseDirectionError(caseDirectionStatusFromRpcError(response.error));
  try {
    return normalizeCaseDirectionReceipt(response.data, { organizationId, studentCaseId, requestId, direction });
  } catch {
    // Кривая расписка может следовать за записанным: исход неизвестен, а не «не вышло».
    throw new PlatformCaseDirectionError("unavailable");
  }
}
