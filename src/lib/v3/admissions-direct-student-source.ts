import "server-only";

import type { PlatformActor } from "../platform-auth";
import type { AdmissionsDirectPayload, AdmissionsDirectResult } from "../admissions-direct-student-contract";
import { normalizeStudentPortalCuratorOptions, type StudentPortalCuratorOption } from "../server/student-portal-curator-options";
import { createSupabaseServerClient } from "../supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID_PREFIX = "admissions_direct_invalid:";

/**
 * «Добавить студента» (миграция 281): один вызов
 * `platform.create_admissions_student_case_v1`. Право, область куратора,
 * идемпотентность по `requestId` и все проверки значений решает база; здесь
 * только перевод ответа в слова формы.
 */
export async function createAdmissionsStudentCase(
  actor: PlatformActor,
  requestId: string,
  payload: AdmissionsDirectPayload,
): Promise<AdmissionsDirectResult> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("create_admissions_student_case_v1", {
    p_organization_id: actor.organizationId,
    p_request_id: requestId,
    p_payload: payload,
  });
  if (error) {
    const message = typeof error.message === "string" ? error.message : "";
    if (error.code === "42501" && message === "admissions_direct_curator_forbidden") return { status: "curator_forbidden" };
    if (error.code === "42501") return { status: "forbidden" };
    if (error.code === "PT409" && message === "admissions_direct_case_exists") return { status: "case_exists" };
    if (error.code === "PT409" && message === "admissions_direct_lead_exists") return { status: "lead_exists" };
    if (error.code === "22023" && message === "admissions_direct_request_conflict") return { status: "request_conflict" };
    if (error.code === "22023" && message.startsWith(INVALID_PREFIX)) {
      const key = message.slice(INVALID_PREFIX.length);
      return { status: "invalid", field: /^[A-Za-z]{1,40}$/u.test(key) ? key : null };
    }
    return { status: "unavailable" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { status: "unavailable" };
  const receipt = data as Record<string, unknown>;
  if (typeof receipt.student_case_id !== "string" || !UUID_PATTERN.test(receipt.student_case_id)
    || receipt.organization_id !== actor.organizationId
    || (receipt.state !== "active" && receipt.state !== "pending")) {
    return { status: "unavailable" };
  }
  return { status: "saved", studentCaseId: receipt.student_case_id.toLowerCase(), state: receipt.state };
}

export type AdmissionsDirectCuratorOptions = Readonly<{
  /** Кураторы, которых актёр может назвать (то же правило области, что у команды 281). */
  options: readonly StudentPortalCuratorOption[];
  /** Может ли актёр оставить дело без куратора («Ждут куратора»). */
  withoutCurator: boolean;
}>;

/**
 * Список «Куратор» в «Добавить студента» (миграция 281,
 * `admissions_direct_curator_options_v1`): только те, кого актёр может
 * назначить, и можно ли оставить дело без куратора. Ошибка чтения бросается:
 * страница решает, чем её заменить.
 */
export async function readAdmissionsDirectCuratorOptions(actor: PlatformActor): Promise<AdmissionsDirectCuratorOptions> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("admissions_direct_curator_options_v1", {
    p_organization_id: actor.organizationId,
  });
  if (error || typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("admissions_direct_curator_options_unavailable");
  }
  const row = data as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "organization_id,owners,without_curator" || typeof row.without_curator !== "boolean") {
    throw new Error("admissions_direct_curator_options_unavailable");
  }
  return Object.freeze({
    options: normalizeStudentPortalCuratorOptions({ organization_id: row.organization_id, owners: row.owners }, actor.organizationId),
    withoutCurator: row.without_curator,
  });
}
