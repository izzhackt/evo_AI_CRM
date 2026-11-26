// Страна справки «Пример» для строки чек-листа - так же, как у веба после миграции 373 (documents/page.tsx):
// первой идёт страна дела (`student_portal_case_directions_v1`), запасной - выбор студента (`student_country_choice_v1`);
// выбирает общий `documentGuideCountry` веба. Оба чтения лежат в кэше кабинета, лист открывается без запроса.
// Сбой любого чтения оставляет другое, без обоих справка общая (страна `null`), как раньше.
import { useCallback } from "react";
import { documentGuideCountry } from "@web/lib/portal/document-guides";

import { useCaseDirections, useCountryChoice } from "@/api/queries";

const NO_DIRECTIONS: ReadonlyMap<string, string> = new Map();

/** Функция «id дела -> страна справки». Меняется, только когда пришли новые данные. */
export function useGuideCountry(): (caseId: string) => string | null {
  const directions = useCaseDirections().data ?? NO_DIRECTIONS;
  const fallback = useCountryChoice().data?.country ?? null;
  return useCallback((caseId: string) => documentGuideCountry(caseId, directions, fallback), [directions, fallback]);
}
