"use server";
import { revalidatePath } from "next/cache";
import { isCountryCuratorDirection, type CountryCuratorFormState } from "./country-curator-contract";
import { isStaffPreview } from "./platform-access";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { saveCountryCurator } from "./v3/country-curators-source";

/**
 * «Настройки → Кураторы стран»: сохранить или убрать куратора страны (миграция 335). Просмотр роли отказывает до любого
 * чтения и записи, затем — только настоящий Admin и один вызов `country_curator_save_v1` с id запроса и версией, которую
 * человек видел. База проверяет Admin и куратора ещё раз.
 */
export async function saveCountryCuratorAction(previous: CountryCuratorFormState, form: FormData): Promise<CountryCuratorFormState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "direction", "expected_version", "curator_membership_id"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const fail = (status: CountryCuratorFormState["status"]): CountryCuratorFormState => ({ status, requestId: requestId ?? previous.requestId });
  if (isStaffPreview(actor)) return fail("forbidden");
  if (!fields || !requestId) return fail("invalid");
  if (actor.systemRole !== "admin") return fail("forbidden");
  const direction = fields.get("direction");
  const version = /^\d{1,15}$/u.test(fields.get("expected_version")!) ? Number(fields.get("expected_version")) : null;
  const rawCurator = fields.get("curator_membership_id")!;
  const curatorId = rawCurator === "" ? null : parseSalesUuid(rawCurator);
  if (!isCountryCuratorDirection(direction) || version === null || (rawCurator !== "" && !curatorId)) return fail("invalid");
  const result = await saveCountryCurator(actor, { direction, expectedVersion: version, curatorId, requestId });
  if (result.status !== "saved" && result.status !== "unchanged") return fail(result.status);
  revalidatePath("/settings");
  return { status: result.status, requestId };
}
