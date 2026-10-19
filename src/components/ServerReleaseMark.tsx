"use client";

import { useEffect } from "react";

import { noteServerRelease } from "@/lib/stale-deployment";

/**
 * Ревизия сервера, которой отрисована страница (A4, docs/PLAN_CHANGES.md
 * 19.10.2026). Запоминается один раз за загрузку страницы и не меняется от
 * `router.refresh()`: ответ лёгкого опроса с другой ревизией отметит страницу
 * как устаревшую. Нужна там, где опрос не получает ревизию пропсом (CRM),
 * иначе ею стала бы ревизия первого ответа, а вкладка, загруженная до выпуска
 * и показанная после него, приняла бы новую сборку за свою.
 */
export function ServerReleaseMark({ release }: { release: string | null }) {
  useEffect(() => { noteServerRelease(release); }, [release]);
  return null;
}
