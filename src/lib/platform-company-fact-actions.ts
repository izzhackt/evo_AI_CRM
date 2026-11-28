"use server";
import { revalidatePath } from "next/cache";

import {
  COMPANY_FACT_LIMITS,
  COMPANY_FACT_TOPIC_PATTERN,
  isCompanyFactAudience,
  isCompanyFactSource,
  type CompanyFactFormState,
} from "./ai-agents/company-facts";
import { isStaffPreview } from "./platform-access";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { retireCompanyFact, saveCompanyFact } from "./v3/company-facts-source";

/**
 * «Настройки → Факты» («мозг компании», миграция 381): добавить или поправить факт и снять его. Просмотр роли отказывает до любого
 * чтения и записи; дальше один вызов RPC с id запроса: права (`ai.agent.manage`), «Проверено», версия и повтор решает база.
 * Id запроса форма повторяет при неизвестном итоге, и база отвечает прежней квитанцией, а не второй записью.
 */

const SAVE_FIELDS = ["request_id", "fact_id", "topic", "audience", "statement_ru", "statement_ky", "statement_en", "source", "source_ref", "valid_until", "mark_verified"] as const;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

const fail = (status: CompanyFactFormState["status"], requestId: string | null, previous: CompanyFactFormState): CompanyFactFormState =>
  ({ status, requestId: requestId ?? previous.requestId });

const clean = (value: string): string => value.replace(/\r\n?/gu, "\n").trim();
const okText = (value: string, max: number): boolean => value.length <= max && !CONTROL.test(value.replace(/\n/gu, ""));

export async function saveCompanyFactAction(previous: CompanyFactFormState, form: FormData): Promise<CompanyFactFormState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, SAVE_FIELDS);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  if (isStaffPreview(actor)) return fail("forbidden", requestId, previous);
  if (!fields || !requestId) return fail("invalid", requestId, previous);

  const rawFact = fields.get("fact_id")!;
  const factId = rawFact === "" ? null : parseSalesUuid(rawFact);
  const ru = clean(fields.get("statement_ru")!);
  const ky = clean(fields.get("statement_ky")!);
  const en = clean(fields.get("statement_en")!);
  const source = fields.get("source")!;
  const sourceRef = clean(fields.get("source_ref")!);
  const until = fields.get("valid_until")!;
  const verified = fields.get("mark_verified")! === "1";
  if ((rawFact !== "" && !factId) || ru === "" || !okText(ru, COMPANY_FACT_LIMITS.statementMaxChars) || !okText(ky, COMPANY_FACT_LIMITS.statementMaxChars)
    || !okText(en, COMPANY_FACT_LIMITS.statementMaxChars) || !isCompanyFactSource(source) || !okText(sourceRef, COMPANY_FACT_LIMITS.sourceRefMaxChars)
    || !(until === "" || DATE.test(until))) return fail("invalid", requestId, previous);

  const patch: Record<string, unknown> = {
    statementRu: ru, statementKy: ky === "" ? null : ky, statementEn: en === "" ? null : en, source,
    sourceRef: sourceRef === "" ? null : sourceRef, validUntil: until === "" ? null : until, markVerified: verified,
  };
  if (factId === null) {
    const topic = fields.get("topic")!.trim();
    const audience = fields.get("audience")!;
    if (topic.length > COMPANY_FACT_LIMITS.topicMaxChars || !COMPANY_FACT_TOPIC_PATTERN.test(topic) || !isCompanyFactAudience(audience)) {
      return fail("invalid", requestId, previous);
    }
    patch.topic = topic;
    patch.audience = audience;
  }
  const result = await saveCompanyFact(actor, { factId, patch, requestId });
  if (result.status !== "saved" && result.status !== "unchanged") return fail(result.status, requestId, previous);
  revalidatePath("/settings");
  return { status: result.status, requestId };
}

export async function retireCompanyFactAction(previous: CompanyFactFormState, form: FormData): Promise<CompanyFactFormState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "fact_id"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  if (isStaffPreview(actor)) return fail("forbidden", requestId, previous);
  const factId = fields && parseSalesUuid(fields.get("fact_id"));
  if (!fields || !requestId || !factId) return fail("invalid", requestId, previous);
  const result = await retireCompanyFact(actor, factId, requestId);
  if (result.status !== "retired") return fail(result.status, requestId, previous);
  revalidatePath("/settings");
  return { status: "retired", requestId };
}
