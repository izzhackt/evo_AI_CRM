import "server-only";
import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  PARENT_PHONE_LOOKALIKES_NONE,
  parseParentPhoneLookalikes,
  type ParentPhoneLookalikesState,
  type ParentPhoneSubject,
} from "../parent-phone-lookalikes-contract.ts";
import { parseSalesUuid } from "../platform-sales-register-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * «Похоже на» лида или дела (`read_parent_phone_lookalikes_v1`, миграция 306): дела, в анкете
 * которых номер субъекта записан как телефон матери или отца. Решает база, и решает для каждого
 * сотрудника по-своему: читаемые дела приходят с именем и ссылкой (`matches`), а о делах, которых
 * сотрудник не читает, база говорит только «есть» (`restricted`), поэтому менеджер продаж, который
 * ведёт лид, получает подсказку, ничего не узнавая о чужом студенте. Поэтому здесь нет проверки прав
 * на уровне страницы: она скрыла бы подсказку как раз от тех, кому нужен второй уровень. Не зовёт базу
 * только просмотр роли (для базы он неотличим от admin и показал бы то, что роль не увидит). Отказ
 * базы (42501) значит «ничего не показывать», как и пустой ответ: страница субъекта уже открыта. Сбой
 * или чужая форма ответа дают `unavailable`, а не пустое «нет совпадений».
 */
export async function readParentPhoneLookalikes(
  actor: ActivePlatformActor,
  subject: ParentPhoneSubject,
): Promise<ParentPhoneLookalikesState> {
  if (isStaffPreview(actor)) return PARENT_PHONE_LOOKALIKES_NONE;
  const leadId = subject.leadId === undefined ? null : parseSalesUuid(subject.leadId);
  const studentCaseId = subject.studentCaseId === undefined ? null : parseSalesUuid(subject.studentCaseId);
  if ((leadId === null) === (studentCaseId === null)) return { status: "unavailable" };
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform")
      .rpc("read_parent_phone_lookalikes_v1", {
        p_organization_id: actor.organizationId, p_lead_id: leadId, p_student_case_id: studentCaseId,
      });
    if (error) return error.code === "42501" ? PARENT_PHONE_LOOKALIKES_NONE : { status: "unavailable" };
    const answer = parseParentPhoneLookalikes(data);
    return answer ? { status: "available", ...answer } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
