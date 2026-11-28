"use server";

/**
 * «Тестовый лид» (миграция 385): переключатель на карточке лида. Форма-действие по образцу platform-closure-actions.ts:
 * точный набор полей, request id, который форма носит с собой, просмотр роли никогда не пишет, «сохранено» — только по
 * квитанции базы. Неизвестный исход оставляет тот же request id: повтор вернёт уже записанное. Права решает SQL.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import { PlatformLeadTestError, parseLeadTestUuid, setLeadIsTest, type LeadTestStatus } from "./platform-lead-test.ts";
import { exactActionStringFields } from "./server/action-form-fields";
import { leadTestOutcome } from "./v3/wording";

export type LeadTestActionState = Readonly<{
  status: "idle" | LeadTestStatus;
  requestId: string;
  /** Честный ответ для экрана; null, пока ничего не нажимали. */
  message: string | null;
  /** Значение, записанное базой (по квитанции); null — неизвестно. */
  isTest: boolean | null;
}>;

const FIELDS = ["lead_id", "is_test", "request_id"] as const;

function refusal(status: Exclude<LeadTestStatus, "saved" | "unchanged">, requestId: string | null, isTest: boolean | null): LeadTestActionState {
  // Request id связан только записанным: после отказа он свободен, кроме случая, когда база сказала «использован иначе».
  const next = status === "request_conflict" || requestId === null ? randomUUID() : requestId;
  return { status, requestId: next, message: leadTestOutcome(status, isTest), isTest: null };
}

export async function leadTestAction(_previous: LeadTestActionState, form: FormData): Promise<LeadTestActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, FIELDS);
  const requestId = parseLeadTestUuid(fields?.get("request_id"));
  const flag = fields?.get("is_test") === "true" ? true : fields?.get("is_test") === "false" ? false : null;
  if (isStaffPreview(actor)) return refusal("preview", requestId, flag);
  if (!staffHasPermission(actor, "lead.sales.workflow.manage")) return refusal("forbidden", requestId, flag);
  const leadId = parseLeadTestUuid(fields?.get("lead_id"));
  if (!fields || !requestId || !leadId || flag === null) return refusal("invalid", requestId, flag);
  try {
    const receipt = await setLeadIsTest(actor, { leadId, isTest: flag, requestId });
    revalidatePath("/pipeline");
    revalidatePath("/profile");
    return {
      status: receipt.changed ? "saved" : "unchanged",
      requestId: randomUUID(),
      message: leadTestOutcome(receipt.changed ? "saved" : "unchanged", receipt.isTest),
      isTest: receipt.isTest,
    };
  } catch (error) {
    return refusal(error instanceof PlatformLeadTestError ? error.status : "unavailable", requestId, flag);
  }
}
