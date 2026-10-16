"use server";

import { revalidatePath } from "next/cache";

import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseAdmissionsDirectPayload, type AdmissionsDirectResult } from "./admissions-direct-student-contract";
import { createAdmissionsStudentCase } from "./v3/admissions-direct-student-source";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * «Добавить студента» в «Воронке поступления» (миграция 281). Подсказка права
 * (`case.create.direct`) и просмотр роли отсекают вызов заранее; область
 * куратора, деньги и идемпотентность проверяет команда базы. Повтор с тем же
 * `requestId` и теми же данными возвращает то же дело.
 */
export async function createAdmissionsStudentAction(input: unknown): Promise<AdmissionsDirectResult> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "case.create.direct")) return { status: "forbidden" };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { status: "invalid", field: null };
  const { requestId, payload } = input as Record<string, unknown>;
  if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId) || Object.keys(input).length !== 2) {
    return { status: "invalid", field: null };
  }
  const parsed = parseAdmissionsDirectPayload(payload);
  if (!parsed) return { status: "invalid", field: null };
  try {
    const result = await createAdmissionsStudentCase(actor, requestId, parsed);
    if (result.status === "saved") {
      revalidatePath("/v3/admissions-pipeline");
      revalidatePath("/v3/profile");
    }
    return result;
  } catch {
    return { status: "unavailable" };
  }
}
