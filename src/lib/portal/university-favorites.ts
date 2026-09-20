/**
 * Чистые помощники избранного каталога (PORT-3b, план §6 «Избранное»,
 * дизайн-контракт §5). Файл клиент-безопасный: без server-only и Supabase.
 *
 * Серверный контракт — миграция 195: student_university_favorites_v1 отдаёт
 * [{institutionId, createdAt}] (только свои записи актора), а
 * student_university_catalog_by_ids_v1 принимает максимум 30 id за вызов —
 * потолок страницы каталога; больший набор читается кусками.
 */
import { universityUuid } from "../platform-university-catalog.ts";

export type UniversityFavorite = Readonly<{
  institutionId: string;
  createdAt: string;
}>;

export type FavoriteActionResult =
  | Readonly<{ ok: true; favored: boolean }>
  | Readonly<{ ok: false }>;

/** Потолок одного вызова by_ids (миграция 195 = LIMIT страницы каталога). */
export const FAVORITES_BY_IDS_CAP = 30;

/**
 * Строгий разбор ответа student_university_favorites_v1. Любое отклонение
 * формы — null (честная ошибка вместо тихо неполного списка).
 */
export function parseUniversityFavorites(
  value: unknown,
): readonly UniversityFavorite[] | null {
  if (!Array.isArray(value)) return null;
  const favorites: UniversityFavorite[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const keys = Object.keys(row);
    if (keys.length !== 2 || !("institutionId" in row) || !("createdAt" in row)) return null;
    const institutionId = universityUuid(row.institutionId);
    if (
      !institutionId
      || favorites.some((favorite) => favorite.institutionId === institutionId)
      || typeof row.createdAt !== "string"
      || !/^\d{4}-\d{2}-\d{2}T/.test(row.createdAt)
      || Number.isNaN(Date.parse(row.createdAt))
    ) return null;
    favorites.push({ institutionId, createdAt: row.createdAt });
  }
  return favorites;
}

/** Куски для by_ids: серверный потолок — 30 id за вызов. */
export function chunkInstitutionIds(
  ids: readonly string[],
  size: number = FAVORITES_BY_IDS_CAP,
): readonly (readonly string[])[] {
  if (size < 1) throw new Error("Chunk size must be positive");
  const chunks: (readonly string[])[] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

/** Разбор ответа set_university_favorite_v1 в результат действия. */
export function parseFavoriteReceipt(value: unknown): FavoriteActionResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false };
  }
  const receipt = value as Record<string, unknown>;
  if (typeof receipt.favored !== "boolean" || !universityUuid(receipt.institutionId)) {
    return { ok: false };
  }
  return { ok: true, favored: receipt.favored };
}
