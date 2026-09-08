"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { createSupabaseServerClient } from "./supabase/server";
import { exactActionStringFields } from "./server/action-form-fields";
import { parseSalesDate, parseSalesInteger, parseSalesUuid, SALES_CURRENCIES } from "./platform-sales-register-contract";

export type SalesRegisterActionState = Readonly<{
  status: "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable";
  requestId: string; recordId: string | null;
}>;
const BASE = ["operation", "request_id", "record_id", "expected_version", "reason"] as const;
const EDIT = ["report_month", "signing_date", "applicant_name", "phone", "country", "university", "program", "direction", "intake",
  "contract_number", "manager_label", "status_raw", "owner_membership_id", "service_cost_raw", "service_cost_minor",
  "service_cost_currency", "paid_raw", "paid_minor", "paid_currency", "needs_review", "notes"] as const;
function candidate(form: FormData, key: string): string | null {
  const entries = [...form.entries()].filter(([name]) => name === key || name === `_1_${key}`);
  return entries.length === 1 && typeof entries[0][1] === "string" ? entries[0][1] : null;
}
function outcome(form: FormData, status: SalesRegisterActionState["status"], recordId?: string): SalesRegisterActionState {
  return { status, requestId: status === "saved" || status === "request_conflict" ? randomUUID() :
    parseSalesUuid(candidate(form, "request_id")) ?? randomUUID(), recordId: recordId ?? parseSalesUuid(candidate(form, "record_id")) };
}
export async function saveSalesRegisterAction(_previous: SalesRegisterActionState, form: FormData): Promise<SalesRegisterActionState> {
  const actor = await requirePlatformStaffActor();
  if (actor.authorityRole !== "admin" && actor.authorityRole !== "sales") return outcome(form, "forbidden");
  const operation = candidate(form, "operation");
  const isEdit = operation === "create" || operation === "update";
  if (!isEdit && operation !== "archive" && operation !== "restore") return outcome(form, "invalid");
  const fields = exactActionStringFields(form, isEdit ? [...BASE, ...EDIT] : BASE);
  if (!fields) return outcome(form, "invalid");
  const requestId = parseSalesUuid(fields.get("request_id"));
  const recordId = fields.get("record_id") === "" ? null : parseSalesUuid(fields.get("record_id"));
  const version = parseSalesInteger(fields.get("expected_version"));
  const reason = fields.get("reason")?.trim() ?? "";
  if (!requestId || version === null || (operation === "create" ? recordId !== null || version !== 0 || fields.get("record_id") !== "" : !recordId || version < 1)
    || reason.length < 1 || reason.length > 1000) return outcome(form, "invalid");
  const payload: Record<string, string | number | boolean | null> = {};
  if (isEdit) {
    for (const key of EDIT) payload[key] = fields.get(key) ?? "";
    const month = parseSalesDate(payload.report_month);
    if (!month?.endsWith("-01") || (payload.signing_date !== "" && !parseSalesDate(payload.signing_date))
      || (payload.needs_review !== "true" && payload.needs_review !== "false")) return outcome(form, "invalid");
    payload.signing_date = payload.signing_date || null;
    payload.needs_review = payload.needs_review === "true";
    const ownerId = payload.owner_membership_id === "" ? null : parseSalesUuid(payload.owner_membership_id);
    if (payload.owner_membership_id !== "" && !ownerId) return outcome(form, "invalid");
    if (actor.authorityRole === "sales" && ownerId !== null && ownerId !== actor.membershipId) return outcome(form, "forbidden");
    payload.owner_membership_id = actor.authorityRole === "sales" ? actor.membershipId : ownerId;
    for (const prefix of ["service_cost", "paid"]) {
      const amount = payload[`${prefix}_minor`] === "" ? null : parseSalesInteger(payload[`${prefix}_minor`], 1_000_000_000_000);
      const currency = payload[`${prefix}_currency`] || null;
      if ((payload[`${prefix}_minor`] !== "" && amount === null) || (amount === null) !== (currency === null)
        || (currency !== null && !SALES_CURRENCIES.includes(currency as typeof SALES_CURRENCIES[number]))) return outcome(form, "invalid");
      payload[`${prefix}_minor`] = amount; payload[`${prefix}_currency`] = currency;
    }
    if (typeof payload.applicant_name !== "string" || !payload.applicant_name.trim()
      || Object.values(payload).some(value => typeof value === "string" && (value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)))) return outcome(form, "invalid");
  }
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("manage_sales_register_v1", {
      p_organization_id: actor.organizationId, p_operation: operation, p_record_id: recordId,
      p_expected_version: version, p_fields: payload, p_reason: reason, p_request_id: requestId,
    });
    if (error) {
      if (error.code === "42501") return outcome(form, "forbidden");
      if (error.code === "PT409") return outcome(form, "stale");
      if ((error.code === "22023" || error.code === "23505") && /request_id/.test(error.message)) return outcome(form, "request_conflict");
      return outcome(form, error.code === "22023" ? "invalid" : "unavailable");
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || data.organization_id !== actor.organizationId
      || data.operation !== operation || data.request_id !== requestId || !parseSalesUuid(data.record_id)
      || (recordId !== null && data.record_id !== recordId) || parseSalesInteger(data.version) !== version + 1) return outcome(form, "unavailable");
    revalidatePath("/v3/main");
    return outcome(form, "saved", data.record_id);
  } catch { return outcome(form, "unavailable"); }
}

export async function saveSalesTargetAction(_previous: SalesRegisterActionState, form: FormData): Promise<SalesRegisterActionState> {
  const actor = await requirePlatformStaffActor();
  if (actor.authorityRole !== "admin") return outcome(form, "forbidden");
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
  if (actor.authorityRole !== "admin") return result("forbidden");
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
