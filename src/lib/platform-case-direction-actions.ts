"use server";

/**
 * «Задать направление» / «Сменить» в «Сведениях» дела: форма на `useActionState`
 * над `platform.set_student_case_direction_v1` (миграция 292). Те же правила,
 * что у platform-case-next-action-actions.ts: точные поля, идентификатор запроса,
 * который форма носит с собой, просмотр роли ничего не пишет, «сохранено» - только
 * по расписке сервера. При неизвестном исходе идентификатор остаётся тем же, и
 * повтор не запишет направление второй раз.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import {
  PlatformCaseDirectionError,
  parseCaseDirection,
  parseExpectedAdmissionsVersion,
  parseQueueUuid,
  setStudentCaseDirection,
  type CaseDirectionReceipt,
  type CaseDirectionStatus,
} from "./platform-case-direction.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import { exactActionStringFields } from "./server/action-form-fields";
import { caseDirectionOutcome } from "./v3/wording";

export type CaseDirectionActionState = Readonly<{
  status: "idle" | CaseDirectionStatus;
  requestId: string;
  /** Честное русское сообщение для формы; null, пока ничего не отправлено. */
  message: string | null;
  receipt: CaseDirectionReceipt | null;
}>;

const CASE_DIRECTION_FIELDS = ["student_case_id", "direction", "expected_version", "request_id"] as const;

function outcome(
  status: Exclude<CaseDirectionStatus, "saved" | "unchanged">,
  requestId: string | null,
): CaseDirectionActionState {
  // Идентификатор привязан только записанным; после отказа он не использован,
  // кроме случая, когда сервер сообщил, что им уже распорядились иначе.
  const next = status === "request_conflict" || requestId === null ? randomUUID() : requestId;
  return { status, requestId: next, message: caseDirectionOutcome(status), receipt: null };
}

export async function setCaseDirectionAction(
  _previous: CaseDirectionActionState,
  form: FormData,
): Promise<CaseDirectionActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, CASE_DIRECTION_FIELDS);
  const requestId = parseQueueUuid(fields?.get("request_id"));
  if (isStaffPreview(actor)) return outcome("preview", requestId);
  if (!staffHasPermission(actor, "case.curator.assign")) return outcome("forbidden", requestId);
  const studentCaseId = parseQueueUuid(fields?.get("student_case_id"));
  const direction = parseCaseDirection(fields?.get("direction"));
  const expectedVersion = parseExpectedAdmissionsVersion(fields?.get("expected_version"));
  if (!fields || !requestId || !studentCaseId || direction === null || expectedVersion === null) {
    return outcome("invalid", requestId);
  }
  try {
    const receipt = await setStudentCaseDirection(actor, { studentCaseId, direction, expectedVersion, requestId });
    revalidatePath("/v3/profile");
    return {
      status: receipt.changed ? "saved" : "unchanged",
      requestId: randomUUID(),
      message: caseDirectionOutcome(receipt.changed ? "saved" : "unchanged"),
      receipt,
    };
  } catch (error) {
    return outcome(error instanceof PlatformCaseDirectionError ? error.status : "unavailable", requestId);
  }
}
