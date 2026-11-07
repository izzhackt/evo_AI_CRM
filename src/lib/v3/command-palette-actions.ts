"use server";

import { requirePlatformStaffActor } from "../platform-guards";
import { searchCommandPalette, type PaletteSearch } from "./command-palette.ts";
import { STUDENT_SEARCH_READERS } from "./student-search-readers";

/**
 * Чтения Ctrl+K — существующие чтения страниц, без новой SQL (`student-search-readers.ts`): каждое отбирает строки
 * правами сотрудника на сервере; `searchCommandPalette` решает, какие группы роли положены, и оставляет только дела
 * с полным доступом.
 */
export async function searchCommandPaletteAction(query: string): Promise<PaletteSearch> {
  const actor = await requirePlatformStaffActor();
  return searchCommandPalette(actor, query, STUDENT_SEARCH_READERS);
}
