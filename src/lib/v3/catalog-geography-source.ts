import "server-only";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth";
import { parseStaffGeography, type StaffGeography } from "../catalog-geography.ts";
import { getSupabasePublicConfig } from "../supabase/config";
import { createSupabaseServerClient } from "../supabase/server";

/**
 * Право редактора географии и стоимости в интерфейсе (план 7.5): то же, что
 * «Управлять каталогом», `catalog.import.manage` вне просмотра роли. Это
 * только подсказка интерфейсу: решает каждый RPC 283.
 */
export function canManageCatalogGeography(actor: ActivePlatformActor): boolean {
  return !isStaffPreview(actor) && staffHasPermission(actor, "catalog.import.manage");
}
/** Подтверждение строк агентств: только системный Admin (контракт 3). */
export function canConfirmAgencyCosts(actor: ActivePlatformActor): boolean {
  return canManageCatalogGeography(actor) && actor.systemRole === "admin";
}

/** Вся география, стоимость и курсы организации; сбой или неверный ответ это ошибка чтения, а не пустой каталог. */
export async function readStaffCatalogGeography(actor: ActivePlatformActor): Promise<StaffGeography> {
  if (!canManageCatalogGeography(actor)) throw new Error("Geography unavailable");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_catalog_geography_v1", { p_organization_id: actor.organizationId });
  const geography = !error && parseStaffGeography(data);
  if (!geography) throw new Error("Geography unavailable");
  return geography;
}

/** Начало публичного адреса фото стран и городов в бакете `portal-university-photos` (контракт 2.5), с «/» в конце. */
export function geographyPhotoBase(): string | null {
  try {
    return `${getSupabasePublicConfig().url}/storage/v1/object/public/portal-university-photos/`;
  } catch {
    return null;
  }
}
