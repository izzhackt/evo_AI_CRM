"use server";

import { revalidatePath } from "next/cache";

import { universityUuid } from "../platform-university-catalog";
import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import { parseFavoriteReceipt, type FavoriteActionResult } from "./university-favorites";

/**
 * Переключение избранного (PORT-3b). RPC set_university_favorite_v1
 * идемпотентен по построению: повтор запроса (retry сети, двойное нажатие)
 * безопасен и возвращает фактическое состояние. Текст ошибки выбирает
 * клиентский компонент по своей локали — экшен отдаёт только результат.
 */
export async function setUniversityFavoriteAction(
  institutionId: unknown,
  favored: unknown,
): Promise<FavoriteActionResult> {
  await requireStudentPortalActor();
  const id = universityUuid(institutionId);
  if (!id || typeof favored !== "boolean") return { ok: false };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .schema("platform")
      .rpc("set_university_favorite_v1", { p_institution_id: id, p_favored: favored });
    if (error) return { ok: false };
    const result = parseFavoriteReceipt(data);
    if (result.ok) revalidatePath("/portal/favorites");
    return result;
  } catch {
    return { ok: false };
  }
}
