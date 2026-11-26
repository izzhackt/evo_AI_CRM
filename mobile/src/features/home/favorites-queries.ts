// Чтения «Всё избранное»: все карточки избранного и число вузов, которых больше нет в каталоге. Лежат отдельно от
// `api/queries.ts`: общий файл чтений правят многие, а эти два нужны только этому экрану. Ключи начинаются так же, как
// у чтения «Главной» (`["portal", user, "favorites"]`), поэтому запись избранного (`refreshFavoriteViews` каталога) и
// «потянуть вниз» обновляют и их.
import { useQuery } from "@tanstack/react-query";
import { parseHiddenUniversityFavorites } from "@web/lib/portal/university-favorites";

import { usePortalApi } from "@/api/PortalApi";
import { readFavorites } from "@/api/portal-reads";
import { PortalDecodeError } from "@/domain/portal-source";
import { rpcRead, type RpcTransport } from "@/lib/rpc";

/**
 * Число своих избранных вузов вне списка стран продукта (`student_hidden_university_favorites_v1`, миграция 282): строка
 * «Больше нет в каталоге: N». Чужая форма ответа - ошибка данных.
 */
export async function readHiddenFavorites(transport: RpcTransport): Promise<number> {
  const count = parseHiddenUniversityFavorites(await rpcRead(transport, "student_hidden_university_favorites_v1"));
  if (count === null) throw new PortalDecodeError();
  return count;
}

/** Без потолка по числу вузов: карточки читаются кусками по 30 (потолок `student_university_catalog_by_ids_v1`). */
export const ALL_FAVORITES = Number.MAX_SAFE_INTEGER;

/** Все избранные вузы (веб `FavoritesSection`: `readStudentUniversitiesByIds` по всем id); читаются, пока открыт полный список. */
export function useAllFavorites(enabled: boolean) {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: ["portal", userKey, "favorites", "all"] as const, queryFn: () => readFavorites(transport, ALL_FAVORITES), enabled });
}

/** Число вузов вне каталога; его сбой список не прячет (веб: `.catch(() => 0)`). */
export function useHiddenFavorites(enabled: boolean) {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: ["portal", userKey, "favorites", "hidden"] as const, queryFn: () => readHiddenFavorites(transport), enabled });
}
