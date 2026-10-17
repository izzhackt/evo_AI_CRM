import "server-only";
import { staffPresentationCan } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth";
import { createSupabaseServerClient } from "../supabase/server";
import { parseCaseSaleConditionsResult, parseLeadSaleConditions, type LeadSaleConditions } from "../lead-sale-conditions-contract";

/**
 * «Условия продажи» read. Used both by the lead card block (Overview) and,
 * through the report's own preview action, by «Отчёт продаж → Добавить
 * продажу» once a lead is chosen — the exact same shape, never a second form.
 */
export async function readLeadSaleConditions(actor: ActivePlatformActor, leadId: string): Promise<LeadSaleConditions> {
  if (!staffPresentationCan(actor, "sales.read")) throw new Error("Sale conditions unavailable.");
  const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("staff_lead_sale_conditions_v1", {
    p_organization_id: actor.organizationId, p_lead_id: leadId,
  });
  if (error) throw new Error("Sale conditions unavailable.");
  return parseLeadSaleConditions(data, actor.organizationId);
}

/**
 * «Данные продажи» дела прямого студента (290): условия продажи его лида,
 * который закрыт для лидовых чтений (`converted`). Право - чтение дела целиком
 * (`case.read.full`), его проверяет сервер; деньги он отдаёт пустыми, если у
 * читателя нет финансового раздела дела. null - у дела нет условий для показа:
 * не дело прямого студента (лид продаж читает карточка лида) или у читателя нет
 * права на дело целиком (читатель «Ждут куратора»: отказ функции `case_sale_conditions_forbidden`). Сбой чтения - исключение:
 * страница называет его, а не рисует пустое место.
 */
export async function readCaseSaleConditions(actor: ActivePlatformActor, studentCaseId: string): Promise<LeadSaleConditions | null> {
  const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("staff_student_case_sale_conditions_v1", {
    p_organization_id: actor.organizationId, p_student_case_id: studentCaseId,
  });
  return parseCaseSaleConditionsResult({ data, error }, actor.organizationId);
}
