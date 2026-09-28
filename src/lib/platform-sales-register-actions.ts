"use server";
import { staffHasPermission, isStaffPreview } from "./platform-access.ts";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformStaffActor } from "./platform-guards";
import { createSupabaseServerClient } from "./supabase/server";
import { exactActionStringFields } from "./server/action-form-fields";
import { parseSalesDate, parseSalesInteger, parseSalesUuid, SALES_CURRENCIES } from "./platform-sales-register-contract";
import { readSalesRegisterIntakeOptions, readSalesRegisterWriteAccess, searchSalesRecordLeadOptions } from "./v3/sales-register-source";
import { readLeadSaleConditions } from "./v3/lead-sale-conditions-source";
import type { LeadSaleConditions } from "./lead-sale-conditions-contract";
import { refreshConfirmedSelfHandoffSession } from "./server/self-handoff-session";
import { parseSalesRecordLeadLinkReceipt, type SalesRecordLeadLinkActionState, type SalesRecordLeadOption } from "./sales-record-lead-contract";

export type SalesRegisterActionState = Readonly<{
  status: "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable" | "already_transferred" | "conditions_missing";
  requestId: string; recordId: string | null; leadId: string | null;
  reportMonth?: string; studentCaseId?: string;
}>;
const BASE = ["operation", "request_id", "record_id", "expected_version"] as const;
const REASON = ["reason"] as const;
// The report chooses an existing lead + curator (unified workflow S2, plan
// §6); conditions themselves are never re-entered here — they live on the
// lead card and platform.create_sales_report_handoff reads them server-side.
const INTAKE = ["lead_id", "curator_membership_id"] as const;
const EDIT = ["report_month", "signing_date", "applicant_name", "phone", "country", "university", "program", "direction", "intake",
  "contract_number", "manager_label", "status_raw", "owner_membership_id", "service_cost_raw", "service_cost_minor",
  "service_cost_currency", "paid_raw", "paid_minor", "paid_currency", "needs_review", "notes"] as const;
// «Оплачено в валюте договора» (253): отдельной парой, не в полях записи.
const CONTRACT = ["paid_contract_minor", "paid_contract_currency"] as const;
function candidate(form: FormData, key: string): string | null {
  const entries = [...form.entries()].filter(([name]) => name === key || name === `_1_${key}`);
  return entries.length === 1 && typeof entries[0][1] === "string" ? entries[0][1] : null;
}
function outcome(form: FormData, status: SalesRegisterActionState["status"], recordId?: string): SalesRegisterActionState {
  return { status, requestId: status === "saved" || status === "request_conflict" ? randomUUID() :
    parseSalesUuid(candidate(form, "request_id")) ?? randomUUID(), recordId: recordId ?? parseSalesUuid(candidate(form, "record_id")),
    leadId: parseSalesUuid(candidate(form, "lead_id")) };
}
export async function saveSalesRegisterAction(_previous: SalesRegisterActionState, form: FormData): Promise<SalesRegisterActionState> {
  const actor = await requirePlatformStaffActor();
  if (!staffHasPermission(actor, "sales.register.manage") || isStaffPreview(actor)) return outcome(form, "forbidden");
  const access = await readSalesRegisterWriteAccess(actor);
  if (access !== "allowed") return outcome(form, access === "denied" ? "forbidden" : "unavailable");
  const operation = candidate(form, "operation");
  if (operation !== "create" && operation !== "update" && operation !== "archive" && operation !== "restore") return outcome(form, "invalid");
  const fields = exactActionStringFields(form, operation === "create" ? [...BASE, ...INTAKE]
    : operation === "update" ? [...BASE, ...REASON, ...EDIT, ...CONTRACT] : [...BASE, ...REASON]);
  if (!fields) return outcome(form, "invalid");
  const requestId = parseSalesUuid(fields.get("request_id"));
  const recordId = fields.get("record_id") === "" ? null : parseSalesUuid(fields.get("record_id"));
  const version = parseSalesInteger(fields.get("expected_version"));
  if (!requestId || version === null || (operation === "create" ? recordId !== null || version !== 0 || fields.get("record_id") !== "" : !recordId || version < 1)) {
    return outcome(form, "invalid");
  }
  const payload: Record<string, string | number | boolean | null> = {};
  let contractMinor: number | null = null;
  let contractCurrency: string | null = null;
  let leadId: string | null = null;
  let curatorId: string | null = null;
  let reason = "";
  if (operation === "create") {
    if (!staffHasPermission(actor, "lead.sales.workflow.manage")) return outcome(form, "invalid");
    leadId = parseSalesUuid(fields.get("lead_id"));
    curatorId = parseSalesUuid(fields.get("curator_membership_id"));
    if (!leadId || !curatorId) return outcome(form, "invalid");
  } else {
    reason = fields.get("reason")?.trim() ?? "";
    if (reason.length < 1 || reason.length > 1000) return outcome(form, "invalid");
  }
  if (operation === "update") {
    for (const key of EDIT) payload[key] = fields.get(key) ?? "";
    const month = parseSalesDate(payload.report_month);
    if (!month?.endsWith("-01") || (payload.signing_date !== "" && !parseSalesDate(payload.signing_date))
      || (payload.needs_review !== "true" && payload.needs_review !== "false")) return outcome(form, "invalid");
    payload.signing_date = payload.signing_date || null;
    payload.needs_review = payload.needs_review === "true";
    const ownerId = payload.owner_membership_id === "" ? null : parseSalesUuid(payload.owner_membership_id);
    if (payload.owner_membership_id !== "" && !ownerId) return outcome(form, "invalid");
    // The command validates this candidate against the record/assignment scope.
    payload.owner_membership_id = ownerId;
    for (const prefix of ["service_cost", "paid"]) {
      const amount = payload[`${prefix}_minor`] === "" ? null : parseSalesInteger(payload[`${prefix}_minor`], 1_000_000_000_000);
      const currency = payload[`${prefix}_currency`] || null;
      if ((payload[`${prefix}_minor`] !== "" && amount === null) || (amount === null) !== (currency === null)
        || (currency !== null && !SALES_CURRENCIES.includes(currency as typeof SALES_CURRENCIES[number]))) return outcome(form, "invalid");
      payload[`${prefix}_minor`] = amount; payload[`${prefix}_currency`] = currency;
    }
    // Сумма в валюте договора — только у записи, оплаченной в другой валюте, и в валюте стоимости.
    const contractRaw = fields.get("paid_contract_minor") ?? "";
    contractMinor = contractRaw === "" ? null : parseSalesInteger(contractRaw, 1_000_000_000_000);
    contractCurrency = fields.get("paid_contract_currency") || null;
    if ((contractRaw !== "" && contractMinor === null) || (contractMinor === null) !== (contractCurrency === null)
      || (contractCurrency !== null && (contractCurrency !== payload.service_cost_currency || payload.paid_currency === null
        || payload.paid_currency === payload.service_cost_currency))) return outcome(form, "invalid");
    if (typeof payload.applicant_name !== "string" || !payload.applicant_name.trim()
      || Object.values(payload).some(value => typeof value === "string" && (value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)))) return outcome(form, "invalid");
  }
  let savedRecordId: string;
  let savedReportMonth: string | undefined;
  let savedCaseId: string | undefined;
  let needsLogin = false;
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = operation === "create" ? await client.schema("platform").rpc("create_sales_report_handoff", {
      p_organization_id: actor.organizationId, p_request_id: requestId, p_lead_id: leadId,
      p_curator_membership_id: curatorId,
    }) : await client.schema("platform").rpc("manage_sales_register_v2", {
      p_organization_id: actor.organizationId, p_operation: operation, p_record_id: recordId,
      p_expected_version: version, p_fields: payload, p_paid_contract_minor: contractMinor,
      p_paid_contract_currency: contractCurrency, p_reason: reason, p_request_id: requestId,
    });
    if (error) {
      if (error.code === "42501") return outcome(form, "forbidden");
      if (error.message.includes("sale_conditions_missing")) return outcome(form, "conditions_missing");
      if (error.message.includes("sales_register_already_transferred")) return outcome(form, "already_transferred");
      if (error.code === "PT409") return outcome(form, "stale");
      if ((error.code === "22023" || error.code === "23505") && /request_id/.test(error.message)) return outcome(form, "request_conflict");
      return outcome(form, error.code === "22023" ? "invalid" : "unavailable");
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || data.organization_id !== actor.organizationId
      || data.operation !== operation || data.request_id !== requestId || !parseSalesUuid(data.record_id)
      || (recordId !== null && data.record_id !== recordId) || parseSalesInteger(data.version) !== version + 1) return outcome(form, "unavailable");
    if (operation === "create") {
      const actualMonth = parseSalesDate(data.report_month);
      const caseId = parseSalesUuid(data.student_case_id);
      if (!caseId || data.curator_membership_id !== curatorId || !actualMonth?.endsWith("-01")) return outcome(form, "unavailable");
      savedReportMonth = actualMonth;
      savedCaseId = caseId;
      // Assignment is already committed. Session recovery is not a reason to
      // invite a second save of this sale.
      if (actor.systemRole === "admin" && curatorId === actor.membershipId) {
        needsLogin = !(await refreshConfirmedSelfHandoffSession(actor));
      }
      revalidatePath("/v3/admissions");
      revalidatePath("/v3/tasks");
      revalidatePath("/v3/profile");
    }
    revalidatePath("/v3/main");
    revalidatePath("/v3/pipeline");
    savedRecordId = data.record_id;
  } catch { return outcome(form, "unavailable"); }
  if (needsLogin) redirect("/login?error=session_invalid");
  return { ...outcome(form, "saved", savedRecordId), reportMonth: savedReportMonth, studentCaseId: savedCaseId };
}

export type SalesReportConditionsPreview =
  | Readonly<{ status: "ready"; conditions: LeadSaleConditions; reportMonth: string | null }>
  | Readonly<{ status: "unavailable" }>;

/** Read-only preview for «Отчёт продаж → Добавить продажу» once a lead is picked. */
export async function readSalesReportConditionsPreviewAction(leadId: string): Promise<SalesReportConditionsPreview> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !parseSalesUuid(leadId)) return { status: "unavailable" };
  try {
    if (await readSalesRegisterWriteAccess(actor) !== "allowed") return { status: "unavailable" };
    const conditions = await readLeadSaleConditions(actor, leadId);
    if (conditions.leadId !== leadId) return { status: "unavailable" };
    return { status: "ready", conditions, reportMonth: conditions.signingDate ? `${conditions.signingDate.slice(0, 7)}-01` : null };
  } catch { return { status: "unavailable" }; }
}

export async function searchSalesRegisterStudentsAction(query: string) {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || typeof query !== "string" || query.trim().length < 2) return { status: "invalid" as const, leads: [] };
  try {
    const options = await readSalesRegisterIntakeOptions(actor, query);
    return { status: "ready" as const, leads: options.leads };
  } catch { return { status: "unavailable" as const, leads: [] }; }
}

/** «Связать с лидом» (254): поиск в маленьком окне панели записи. */
export async function searchSalesRecordLeadOptionsAction(query: string): Promise<
  Readonly<{ status: "ready" | "invalid" | "unavailable"; options: readonly SalesRecordLeadOption[] }>
> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || typeof query !== "string" || query.trim().length < 2) return { status: "invalid", options: [] };
  try {
    return { status: "ready", options: await searchSalesRecordLeadOptions(actor, query) };
  } catch { return { status: "unavailable", options: [] }; }
}

/**
 * «Связать с лидом» / «Отвязать от лида» (254): те же ворота, что запись
 * отчёта (`sales.register.manage` на записи, страж 208 Sales Manager), плюс
 * `lead.read` на затрагиваемом лиде — проверяет сервер. `lead_id` пусто —
 * отвязка.
 */
export async function linkSalesRecordLeadAction(_previous: SalesRecordLeadLinkActionState, form: FormData): Promise<SalesRecordLeadLinkActionState> {
  const actor = await requirePlatformStaffActor();
  const outcome = (status: SalesRecordLeadLinkActionState["status"], recordId?: string): SalesRecordLeadLinkActionState => ({
    status, requestId: status === "saved" || status === "request_conflict" ? randomUUID() : parseSalesUuid(candidate(form, "request_id")) ?? randomUUID(),
    recordId: recordId ?? parseSalesUuid(candidate(form, "record_id")),
  });
  if (!staffHasPermission(actor, "sales.register.manage") || isStaffPreview(actor)) return outcome("forbidden");
  const fields = exactActionStringFields(form, ["request_id", "record_id", "expected_version", "lead_id"]);
  if (!fields) return outcome("invalid");
  const requestId = parseSalesUuid(fields.get("request_id"));
  const recordId = parseSalesUuid(fields.get("record_id"));
  const version = parseSalesInteger(fields.get("expected_version"));
  const leadIdRaw = fields.get("lead_id") ?? "";
  const leadId = leadIdRaw === "" ? null : parseSalesUuid(leadIdRaw);
  if (!requestId || !recordId || version === null || version < 1 || (leadIdRaw !== "" && !leadId)) return outcome("invalid");
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("link_sales_record_lead_v1", {
      p_organization_id: actor.organizationId, p_record_id: recordId, p_expected_version: version, p_lead_id: leadId, p_request_id: requestId,
    });
    if (error) {
      if (error.code === "42501") return outcome("forbidden");
      if (error.code === "PT409") {
        if (error.message.includes("sales_register_lead_has_sale")) return outcome("lead_has_sale");
        if (error.message.includes("sales_register_lead_already_linked")) return outcome("lead_already_linked");
        return outcome("stale");
      }
      if (error.code === "22023" && /request_id/.test(error.message)) return outcome("request_conflict");
      return outcome(error.code === "22023" ? "invalid" : "unavailable");
    }
    const savedVersion = parseSalesRecordLeadLinkReceipt(data, {
      organizationId: actor.organizationId, recordId, requestId, expectedVersion: version, operation: leadId === null ? "unlink" : "link",
    });
    if (savedVersion === null) return outcome("unavailable");
    revalidatePath("/v3/main");
    revalidatePath("/v3/profile");
    return outcome("saved", recordId);
  } catch { return outcome("unavailable"); }
}

export async function saveSalesTargetAction(_previous: SalesRegisterActionState, form: FormData): Promise<SalesRegisterActionState> {
  const actor = await requirePlatformStaffActor();
  if (!staffHasPermission(actor, "sales.register.target.manage") || isStaffPreview(actor)) return outcome(form, "forbidden");
  const fields = exactActionStringFields(form, ["request_id", "record_id", "expected_version", "reason", "report_month", "manager_label", "target_count"]);
  if (!fields) return outcome(form, "invalid");
  const requestId = parseSalesUuid(fields.get("request_id"));
  const recordId = fields.get("record_id") === "" ? null : parseSalesUuid(fields.get("record_id"));
  const version = parseSalesInteger(fields.get("expected_version"));
  const month = parseSalesDate(fields.get("report_month"));
  const count = parseSalesInteger(fields.get("target_count"), 1000000);
  const manager = fields.get("manager_label")?.trim() ?? "";
  const reason = fields.get("reason")?.trim() ?? "";
  if (!requestId || version === null || count === null || !month?.endsWith("-01") || manager.length > 300 || !reason || reason.length > 1000
    || (fields.get("record_id") !== "" && !recordId) || (recordId === null) !== (version === 0)) return outcome(form, "invalid");
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("manage_sales_register_target_v1", {
      p_organization_id: actor.organizationId, p_record_id: recordId, p_expected_version: version,
      p_report_month: month, p_manager_label: manager || null, p_target_count: count, p_reason: reason, p_request_id: requestId,
    });
    if (error) {
      if (error.code === "42501") return outcome(form, "forbidden");
      if (error.code === "PT409") return outcome(form, "stale");
      if ((error.code === "22023" || error.code === "23505") && /request_id/.test(error.message)) return outcome(form, "request_conflict");
      return outcome(form, error.code === "22023" ? "invalid" : "unavailable");
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || data.organization_id !== actor.organizationId
      || data.operation !== "target" || data.request_id !== requestId || !parseSalesUuid(data.record_id)
      || (recordId !== null && data.record_id !== recordId) || parseSalesInteger(data.version) !== version + 1) return outcome(form, "unavailable");
    revalidatePath("/v3/main");
    return outcome(form, "saved", data.record_id);
  } catch { return outcome(form, "unavailable"); }
}

export type SalesImportActionState = SalesRegisterActionState & Readonly<{
  importResult: null | Readonly<{
    sourceSha256: string; inserted: number; skipped: number; mismatches: number;
    targetsInserted: number; targetsSkipped: number; targetsMismatched: number;
  }>;
}>;
export async function importSalesRegisterAction(_previous: SalesImportActionState, form: FormData): Promise<SalesImportActionState> {
  const result = (status: SalesRegisterActionState["status"]): SalesImportActionState => ({ ...outcome(form, status), importResult: null });
  const actor = await requirePlatformStaffActor();
  if (!staffHasPermission(actor, "sales.register.import") || isStaffPreview(actor)) return result("forbidden");
  const normalized = new FormData();
  let file: File | null = null;
  for (const [key, value] of form.entries()) {
    if ((key === "import_file" || key === "_1_import_file") && typeof value !== "string") {
      if (file) return result("invalid"); file = value; normalized.append(key, "json-file");
    } else normalized.append(key, value);
  }
  const fields = exactActionStringFields(normalized, ["request_id", "import_file"]);
  const requestId = fields ? parseSalesUuid(fields.get("request_id")) : null;
  if (!fields || !requestId || !file || file.size < 2 || file.size > 900000) return result("invalid");
  try {
    const payload: unknown = JSON.parse(await file.text());
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return result("invalid");
    const input = payload as Record<string, unknown>;
    if (Object.keys(input).length !== 3 || !Object.keys(input).every(key => ["source_sha256", "sales", "targets"].includes(key))
      || typeof input.source_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.source_sha256)
      || !Array.isArray(input.sales) || input.sales.length > 250 || !Array.isArray(input.targets) || input.targets.length > 120) return result("invalid");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("import_sales_register_v1", {
      p_organization_id: actor.organizationId, p_request_id: requestId, p_payload: input,
    });
    if (error) {
      if (error.code === "42501") return result("forbidden");
      if ((error.code === "22023" || error.code === "23505") && /request_id/.test(error.message)) return result("request_conflict");
      return result(error.code === "22023" ? "invalid" : "unavailable");
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || data.organization_id !== actor.organizationId
      || data.operation !== "import" || data.request_id !== requestId || data.source_sha256 !== input.source_sha256) return result("unavailable");
    const inserted = parseSalesInteger(data.inserted, 250), skipped = parseSalesInteger(data.skipped, 250), mismatches = parseSalesInteger(data.mismatches, 250);
    const targetsInserted = parseSalesInteger(data.targets_inserted, 120), targetsSkipped = parseSalesInteger(data.targets_skipped, 120), targetsMismatched = parseSalesInteger(data.targets_mismatched, 120);
    if (inserted === null || skipped === null || mismatches === null || targetsInserted === null || targetsSkipped === null || targetsMismatched === null
      || inserted + skipped + mismatches !== input.sales.length || targetsInserted + targetsSkipped + targetsMismatched !== input.targets.length) return result("unavailable");
    revalidatePath("/v3/main");
    return { ...outcome(form, "saved"), importResult: { sourceSha256: input.source_sha256, inserted, skipped, mismatches, targetsInserted, targetsSkipped, targetsMismatched } };
  } catch { return result("unavailable"); }
}

export type SalesManagerLabelActionState = Readonly<{
  status: "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable";
  requestId: string; key: string | null;
}>;

/**
 * «Менеджеры в отчёте» (253): имя в отчёте для ключа написания и, по желанию,
 * сотрудник CRM. Пустое имя без сотрудника снимает сопоставление. Проверки
 * права, версии и ключа — на сервере (`save_sales_manager_label_v1`).
 */
export async function saveSalesManagerLabelAction(_previous: SalesManagerLabelActionState, form: FormData): Promise<SalesManagerLabelActionState> {
  const fields = exactActionStringFields(form, ["request_id", "label_key", "expected_version", "display_name", "membership_id"]);
  const requestId = parseSalesUuid(fields?.get("request_id"));
  const key = fields?.get("label_key") ?? null;
  const result = (status: SalesManagerLabelActionState["status"]): SalesManagerLabelActionState => ({
    status, requestId: status === "saved" || status === "request_conflict" || !requestId ? randomUUID() : requestId, key,
  });
  const actor = await requirePlatformStaffActor();
  if (!staffHasPermission(actor, "sales.register.import") || isStaffPreview(actor)) return result("forbidden");
  const version = parseSalesInteger(fields?.get("expected_version"));
  const displayName = fields?.get("display_name")?.trim() ?? "";
  const membershipId = fields?.get("membership_id") ? parseSalesUuid(fields.get("membership_id")) : null;
  if (!fields || !requestId || !key || key.length > 300 || version === null || displayName.length > 300
    || /[\u0000-\u001f\u007f]/.test(key + displayName) || (fields.get("membership_id") && !membershipId)
    || (membershipId && !displayName) || (!displayName && version === 0)) return result("invalid");
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("save_sales_manager_label_v1", {
      p_organization_id: actor.organizationId, p_label_key: key, p_expected_version: version,
      p_display_name: displayName || null, p_membership_id: membershipId, p_request_id: requestId,
    });
    if (error) {
      if (error.code === "42501") return result("forbidden");
      if (error.code === "PT409") return result("stale");
      if (error.code === "22023" && /request_id/.test(error.message)) return result("request_conflict");
      return result(error.code === "22023" ? "invalid" : "unavailable");
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || data.organization_id !== actor.organizationId
      || data.operation !== "manager_label" || data.request_id !== requestId || data.label_key !== key
      || parseSalesInteger(data.version) !== version + 1) return result("unavailable");
    revalidatePath("/v3/main");
    return result("saved");
  } catch { return result("unavailable"); }
}
