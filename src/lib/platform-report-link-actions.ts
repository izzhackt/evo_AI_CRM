"use server";
import { revalidatePath } from "next/cache";
import { parseLookerEmbedInput } from "./looker-report-link";
import { isStaffPreview } from "./platform-access";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { isReportKey, type ReportKey, type ReportLinkFormState } from "./report-link-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { saveReportLink } from "./v3/report-links-source";

/**
 * «Настройки → Отчёты»: сохранить или убрать ссылку на отчёт Looker Studio (миграция 323). Просмотр роли отказывает до
 * любого чтения и записи («Preview never writes»), затем — только настоящий Admin, разбор ссылки (в базу уходят
 * идентификаторы, а не адрес) и один вызов `organization_report_link_save_v1` с id запроса и версией, которую человек
 * видел. База проверяет Admin и формат ещё раз.
 */
async function save(previous: ReportLinkFormState, form: FormData, remove: boolean): Promise<ReportLinkFormState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, remove ? ["request_id", "report_key", "expected_version"] : ["request_id", "report_key", "expected_version", "embed"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const fail = (status: ReportLinkFormState["status"]): ReportLinkFormState => ({ status, requestId: requestId ?? previous.requestId });
  if (isStaffPreview(actor)) return fail("forbidden");
  if (!fields || !requestId) return fail("invalid");
  if (actor.systemRole !== "admin") return fail("forbidden");
  const reportKey = fields.get("report_key");
  const version = /^\d{1,15}$/u.test(fields.get("expected_version")!) ? Number(fields.get("expected_version")) : null;
  if (!isReportKey(reportKey) || version === null) return fail("invalid");

  let reportId: string | null = null, pageId: string | null = null;
  if (!remove) {
    const parsed = parseLookerEmbedInput(fields.get("embed"));
    if (!parsed.ok) return fail(parsed.error === "not_looker" || parsed.error === "share_link" ? parsed.error : "invalid");
    reportId = parsed.reportId;
    pageId = parsed.pageId;
  }
  const result = await saveReportLink(actor, { reportKey: reportKey as ReportKey, expectedVersion: version, reportId, pageId, requestId });
  if (result.status !== "saved" && result.status !== "unchanged") return fail(result.status);
  revalidatePath("/v3/settings");
  revalidatePath("/v3/marketing");
  revalidatePath("/v3/finance");
  return { status: result.status === "unchanged" ? "unchanged" : remove ? "removed" : "saved", requestId };
}

export async function saveReportLinkAction(previous: ReportLinkFormState, form: FormData): Promise<ReportLinkFormState> {
  return save(previous, form, false);
}

export async function removeReportLinkAction(previous: ReportLinkFormState, form: FormData): Promise<ReportLinkFormState> {
  return save(previous, form, true);
}
