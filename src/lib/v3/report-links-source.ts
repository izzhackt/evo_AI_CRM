import "server-only";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  parseReportLink, parseReportLinkSaved,
  type ReportKey, type ReportLinkRead, type ReportLinkSaveResult,
} from "../report-link-contract.ts";
import { parseSalesUuid } from "../platform-sales-register-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * Ссылки на отчёты Looker Studio (миграция 323; план `docs/EVO_LOOKER_REPORTS_PLAN_2026-10-27.md` §4, §6).
 *
 * Решение принимает база: «Маркетинг» читает только системный Admin, «Финансы» — Admin или держатель
 * `finance.read.full` на ВСЮ организацию, правит только Admin. Здесь стоит дешёвый отказ до обращения к базе (подсказка
 * роли, не право) и разбор ответа: страница не показывает ничего, что не прошло `parseReportLink`. Просмотр роли
 * (Admin «смотрит как…») для базы неотличим от Admin, поэтому его отказ — в маршрутах страниц и в действиях.
 */

type RpcError = Readonly<{ code?: string; message?: string }>;

/** Подсказка роли: кто вообще может спросить базу об этом отчёте (решает всё равно база). */
function mayAsk(actor: ActivePlatformActor, key: ReportKey): boolean {
  return actor.systemRole === "admin" || (key === "finance" && staffHasPermission(actor, "finance.read.full"));
}

/** Чтение ссылки. `denied` — отказ роли, `unavailable` — сбой или ответ не той формы; нуля и «не подключён» наугад нет. */
export async function readReportLink(actor: ActivePlatformActor, key: ReportKey): Promise<ReportLinkRead> {
  if (!mayAsk(actor, key)) return { status: "denied" };
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform").rpc("organization_report_link_v1", { p_organization_id: actor.organizationId, p_report_key: key });
    if (error) return error.code === "42501" ? { status: "denied" } : { status: "unavailable" };
    const link = parseReportLink(data, { organizationId: actor.organizationId, reportKey: key });
    return link ? { status: "available", link } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Пункт «Финансы» в меню и палитре (план §6.2, точная проверка). Просмотр роли и сотрудник без `finance.read.full` в
 * снимке — `false` без чтения; настоящий Admin — `true` без чтения; держатель права — одно лёгкое чтение той же
 * функции, что решает доступ к странице (она проверяет область «вся организация»: `own`, `department`, `direction` и
 * `record` дают отказ). Любая ошибка чтения — `false`: пункт скрыт, страница по прямому адресу отвечает честно.
 */
export async function readFinanceSectionAccess(actor: ActivePlatformActor): Promise<boolean> {
  if (isStaffPreview(actor)) return false;
  if (actor.systemRole === "admin") return true;
  if (!staffHasPermission(actor, "finance.read.full")) return false;
  return (await readReportLink(actor, "finance")).status === "available";
}

export type ReportLinkSaveInput = Readonly<{
  reportKey: ReportKey;
  expectedVersion: number;
  /** `null` — убрать отчёт; страница бывает только у отчёта. */
  reportId: string | null;
  pageId: string | null;
  requestId: string;
}>;

function saveFailure(error: RpcError): ReportLinkSaveResult {
  if (error.code === "42501") return { status: "forbidden" };
  if (error.code === "22023") return { status: "invalid" };
  if (error.code === "PT409") return { status: "version_conflict" };
  if (error.code === "23505") return { status: "request_conflict" };
  return { status: "unavailable" };
}

/** Правка ссылки (`organization_report_link_save_v1`): только настоящий Admin, не просмотр роли; база проверяет ещё раз. */
export async function saveReportLink(actor: ActivePlatformActor, input: ReportLinkSaveInput): Promise<ReportLinkSaveResult> {
  if (isStaffPreview(actor) || actor.systemRole !== "admin") return { status: "forbidden" };
  const requestId = parseSalesUuid(input.requestId);
  if (!requestId || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) return { status: "invalid" };
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("organization_report_link_save_v1", {
      p_organization_id: actor.organizationId, p_report_key: input.reportKey, p_expected_version: input.expectedVersion,
      p_report_id: input.reportId, p_page_id: input.pageId, p_request_id: requestId,
    });
    if (error) return saveFailure(error);
    const saved = parseReportLinkSaved(data, { organizationId: actor.organizationId, reportKey: input.reportKey });
    return saved ? { status: saved.status, link: saved.link } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
