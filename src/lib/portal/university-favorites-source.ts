import "server-only";

import {
  parseUniversityPage,
  type PublishedUniversity,
} from "../platform-university-catalog";
import { createSupabaseServerClient } from "../supabase/server";
import {
  chunkInstitutionIds,
  parseUniversityFavorites,
  type UniversityFavorite,
} from "./university-favorites";

/**
 * Серверные чтения избранного (PORT-3b). RPC миграции 195 выводят актора и
 * организацию из живой Student-сессии — никакой параметр не адресует чужой
 * membership; здесь только транспорт и строгий разбор.
 */

export async function readStudentUniversityFavorites(): Promise<readonly UniversityFavorite[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .schema("platform")
    .rpc("student_university_favorites_v1");
  const favorites = !error && parseUniversityFavorites(data);
  if (!favorites) throw new Error("Favourites unavailable");
  return favorites;
}

/**
 * Карточки по списку id в порядке списка. Серверный потолок by_ids — 30 id,
 * поэтому больший набор читается последовательными кусками; неполный ответ —
 * честная ошибка, не тихо укороченный список.
 */
export async function readStudentUniversitiesByIds(
  ids: readonly string[],
): Promise<readonly PublishedUniversity[]> {
  if (ids.length === 0) return [];
  const client = await createSupabaseServerClient();
  const byId = new Map<string, PublishedUniversity>();
  for (const chunk of chunkInstitutionIds(ids)) {
    const { data, error } = await client
      .schema("platform")
      .rpc("student_university_catalog_by_ids_v1", { p_institution_ids: [...chunk] });
    const page = !error && parseUniversityPage(data);
    if (!page) throw new Error("Favourites unavailable");
    for (const item of page.items) byId.set(item.id, item);
  }
  const items = ids
    .map((id) => byId.get(id))
    .filter((item): item is PublishedUniversity => item !== undefined);
  if (items.length !== ids.length) throw new Error("Favourites unavailable");
  return items;
}
