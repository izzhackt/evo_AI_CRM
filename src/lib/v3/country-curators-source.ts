import "server-only";

import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  parseCountryCurators, parseCountryCuratorSaved,
  type CountryCuratorDirection, type CountryCuratorSaveResult, type CountryCuratorsRead,
} from "../country-curator-contract.ts";
import { parseSalesUuid } from "../platform-sales-register-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * «Настройки → Кураторы стран» (миграция 335). Решает база: читает и правит только системный Admin. Здесь дешёвый отказ до
 * обращения к базе и разбор ответа; просмотр роли для базы неотличим от Admin, поэтому его отказ — здесь и в действии.
 */
export async function readCountryCurators(actor: ActivePlatformActor): Promise<CountryCuratorsRead> {
  if (actor.systemRole !== "admin") return { status: "denied" };
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform").rpc("country_curators_v1", { p_organization_id: actor.organizationId });
    if (error) return error.code === "42501" ? { status: "denied" } : { status: "unavailable" };
    const parsed = parseCountryCurators(data, actor.organizationId);
    return parsed ? { status: "available", data: parsed } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export type CountryCuratorSaveInput = Readonly<{
  direction: CountryCuratorDirection;
  expectedVersion: number;
  /** `null` — убрать куратора страны. */
  curatorId: string | null;
  requestId: string;
}>;

export async function saveCountryCurator(actor: ActivePlatformActor, input: CountryCuratorSaveInput): Promise<CountryCuratorSaveResult> {
  if (isStaffPreview(actor) || actor.systemRole !== "admin") return { status: "forbidden" };
  const requestId = parseSalesUuid(input.requestId);
  const curatorId = input.curatorId === null ? null : parseSalesUuid(input.curatorId);
  if (!requestId || (input.curatorId !== null && !curatorId) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    return { status: "invalid" };
  }
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("country_curator_save_v1", {
      p_organization_id: actor.organizationId, p_direction: input.direction, p_expected_version: input.expectedVersion,
      p_curator_membership_id: curatorId, p_request_id: requestId,
    });
    if (error) {
      if (error.code === "42501") return { status: "forbidden" };
      if (error.code === "22023") return { status: "invalid" };
      if (error.code === "PT409") return { status: "version_conflict" };
      if (error.code === "23505") return { status: "request_conflict" };
      return { status: "unavailable" };
    }
    const status = parseCountryCuratorSaved(data, actor.organizationId, input.direction);
    return status ? { status } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
