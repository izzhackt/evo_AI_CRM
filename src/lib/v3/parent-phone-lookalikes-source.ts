import "server-only";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  parseParentPhoneLookalikes,
  type ParentPhoneLookalikesState,
  type ParentPhoneSubject,
} from "../parent-phone-lookalikes-contract.ts";
import { parseSalesUuid } from "../platform-sales-register-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * «Похоже на» лида или дела (`read_parent_phone_lookalikes_v1`, миграция 306): дела, в анкете
 * которых номер субъекта записан как телефон матери или отца. Решает база (читает ли сотрудник
 * субъект, дело и его анкету); здесь только подсказка интерфейса, чтобы не звать базу тем, кому она
 * ничего не покажет: просмотр роли (для базы он неотличим от admin) и сотрудник без `case.read.full`
 * и `profile.read.full`. Отказ базы (42501) значит «ничего не показывать», как и пустой ответ: страница
 * субъекта уже открыта. Сбой или чужая форма ответа дают `unavailable`, а не пустое «нет совпадений».
 */
export async function readParentPhoneLookalikes(
  actor: ActivePlatformActor,
  subject: ParentPhoneSubject,
): Promise<ParentPhoneLookalikesState> {
  const none: ParentPhoneLookalikesState = { status: "available", matches: [] };
  if (isStaffPreview(actor) || !staffHasPermission(actor, "case.read.full") || !staffHasPermission(actor, "profile.read.full")) return none;
  const leadId = subject.leadId === undefined ? null : parseSalesUuid(subject.leadId);
  const studentCaseId = subject.studentCaseId === undefined ? null : parseSalesUuid(subject.studentCaseId);
  if ((leadId === null) === (studentCaseId === null)) return { status: "unavailable" };
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform")
      .rpc("read_parent_phone_lookalikes_v1", {
        p_organization_id: actor.organizationId, p_lead_id: leadId, p_student_case_id: studentCaseId,
      });
    if (error) return error.code === "42501" ? none : { status: "unavailable" };
    const matches = parseParentPhoneLookalikes(data);
    return matches ? { status: "available", matches } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
